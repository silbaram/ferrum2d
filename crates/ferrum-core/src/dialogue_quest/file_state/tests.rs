use super::*;
fn config() -> Vec<u8> {
    let mut w = Writer::new();
    w.u32(1);
    w.string("__proto__");
    w.u32(1);
    w.string("constructor");
    w.0
}
fn updates(action: u32, quest: &str, objective: Option<&str>) -> Vec<u8> {
    let mut w = Writer::new();
    w.u32(1);
    w.string(quest);
    w.u32(action);
    w.optional(None);
    w.optional(objective);
    w.0
}
fn graph(bad: bool) -> Vec<u8> {
    let mut w = Writer::new();
    w.u32(0);
    w.u32(2);
    w.string("constructor");
    w.u32(0);
    w.u32(1);
    w.string("__proto__");
    w.u32(0);
    w.optional(None);
    w.optional(None);
    w.u32(1);
    w.u32(1);
    w.u32(1);
    w.string("🙂");
    w.u32(0);
    w.u32(0);
    w.u32(1);
    w.string(if bad { "missing" } else { "__proto__" });
    w.u32(2);
    w.optional(None);
    w.optional(Some("objective"));
    w.string("done");
    w.u32(1);
    w.u32(0);
    w.u32(0);
    w.0
}
fn dialogue(id: &str, flags: &[&str], ended: bool) -> Vec<u8> {
    let mut w = Writer::new();
    w.string(id);
    w.u32(flags.len() as u32);
    for f in flags {
        w.string(f);
    }
    w.u32(u32::from(ended));
    w.0
}
fn progress() -> Vec<u8> {
    let mut w = Writer::new();
    w.u32(1);
    w.string("__proto__");
    w.u32(2);
    w.optional(Some("arbitrary unknown stage"));
    w.u32(3);
    for s in ["constructor", "constructor", "🙂"] {
        w.string(s);
    }
    w.0
}
fn qpacket(q: &NativeQuestLog) -> Vec<u8> {
    let h = q.file_state_packet(&[]).unwrap();
    assert_eq!(h.len(), 16);
    let p = q.file_state_packet(&h).unwrap();
    assert_eq!(&p[..16], h);
    assert_eq!(p.len(), 16 + q.snapshot().len());
    assert_eq!(&p[16..], q.snapshot());
    p
}
fn dpacket(d: &NativeDialogueSession) -> Vec<u8> {
    let h = d.file_state_packet(&[]).unwrap();
    assert_eq!(h.len(), 32);
    let p = d.file_state_packet(&h).unwrap();
    assert_eq!(&p[..32], h);
    let bytes = d.snapshot();
    assert_eq!(&p[32..32 + bytes.len()], bytes);
    if let Some(q) = &d.quests {
        assert_eq!(
            &p[32 + bytes.len()..],
            progress_packet(&q.borrow().progress)
        );
    } else {
        assert_eq!(p.len(), 32 + bytes.len());
    }
    p
}
#[test]
fn file_dialogue_quest_probe_checked_current_packets_and_all_public_commit_sizes() {
    let mut q = NativeQuestLog::new(&config()).unwrap();
    qpacket(&q);
    let h = q.file_state_packet(&[]).unwrap();
    q.apply(&updates(0, "__proto__", None)).unwrap();
    assert_ne!(q.file_state_packet(&[]).unwrap(), h);
    qpacket(&q);
    q.restore(&progress()).unwrap();
    assert_eq!(q.snapshot(), progress());
    qpacket(&q);
    let mut d = NativeDialogueSession::with_quests(&graph(false), &q).unwrap();
    dpacket(&d);
    qpacket(&q);
    d.choose(0).unwrap();
    dpacket(&d);
    qpacket(&q);
    d.restore(&dialogue("constructor", &["z", "a", "a"], false))
        .unwrap();
    dpacket(&d);
    let mut wrong = d.file_state_packet(&[]).unwrap();
    wrong[12] ^= 1;
    assert!(d.file_state_packet(&wrong).is_err());
    assert!(d.file_state_packet(&[0; 31]).is_err());
    dpacket(&d);
}
#[test]
fn file_dialogue_quest_aba_same_restore_and_failed_mutations_keep_source_atomic() {
    let mut q = NativeQuestLog::new(&config()).unwrap();
    let a = q.snapshot();
    let h = q.file_state_packet(&[]).unwrap();
    q.restore(&a).unwrap();
    assert_eq!(q.snapshot(), a);
    assert!(q.file_state_packet(&h).is_err());
    let before = qpacket(&q);
    assert!(q.apply(&updates(0, "missing", None)).is_err());
    assert_eq!(qpacket(&q), before);
    let mut d = NativeDialogueSession::with_quests(&graph(true), &q).unwrap();
    let before = dpacket(&d);
    let qb = qpacket(&q);
    assert!(d.choose(0).is_err());
    assert_eq!(dpacket(&d), before);
    assert_eq!(qpacket(&q), qb);
    let same = d.snapshot();
    let h = d.file_state_packet(&[]).unwrap();
    d.restore(&same).unwrap();
    assert_eq!(d.snapshot(), same);
    assert!(d.file_state_packet(&h).is_err());
}
#[test]
fn file_dialogue_quest_actual_rc_alias_survives_public_wrapper_drop_and_cold_link_does_not_replay()
{
    let mut q = NativeQuestLog::new(&config()).unwrap();
    let mut a = NativeDialogueSession::with_quests(&graph(false), &q).unwrap();
    let b = NativeDialogueSession::with_quests(&graph(false), &q).unwrap();
    assert!(Rc::ptr_eq(
        a.quests.as_ref().unwrap(),
        b.quests.as_ref().unwrap()
    ));
    q.restore(&progress()).unwrap();
    let saved = q.snapshot();
    drop(q);
    let old = b.file_state_packet(&[]).unwrap();
    a.choose(0).unwrap();
    assert!(b.file_state_packet(&old).is_err());
    assert_eq!(
        a.quests.as_ref().unwrap().borrow().progress,
        b.quests.as_ref().unwrap().borrow().progress
    );
    dpacket(&a);
    dpacket(&b);
    let mut fresh = NativeQuestLog::new(&config()).unwrap();
    fresh.restore(&saved).unwrap();
    let h = fresh.file_state_packet(&[]).unwrap();
    let one = NativeDialogueSession::file_with_quests(
        &graph(false),
        &dialogue("constructor", &[], false),
        &fresh,
    )
    .unwrap();
    let two = NativeDialogueSession::file_with_quests(
        &graph(false),
        &dialogue("done", &[], false),
        &fresh,
    )
    .unwrap();
    assert_eq!(fresh.snapshot(), saved);
    assert_eq!(fresh.file_state_packet(&[]).unwrap(), h);
    assert!(Rc::ptr_eq(
        one.quests.as_ref().unwrap(),
        two.quests.as_ref().unwrap()
    ));
    assert!(!two.progress.ended);
    drop(fresh);
    dpacket(&one);
    dpacket(&two);
}
#[test]
fn file_dialogue_quest_strict_file_flags_never_sort_or_deduplicate_and_preserve_native_unicode_order(
) {
    let q = NativeQuestLog::new(&config()).unwrap();
    let before = qpacket(&q);
    for flags in [vec!["same", "same"], vec!["\u{10000}", "\u{e000}"]] {
        assert!(NativeDialogueSession::file_with_quests(
            &graph(false),
            &dialogue("constructor", &flags, false),
            &q
        )
        .is_err());
        assert_eq!(qpacket(&q), before);
    }
    let d = NativeDialogueSession::file_with_quests(
        &graph(false),
        &dialogue("constructor", &["\u{e000}", "\u{10000}"], false),
        &q,
    )
    .unwrap();
    assert_eq!(
        d.snapshot(),
        dialogue("constructor", &["\u{e000}", "\u{10000}"], false)
    );
    dpacket(&d);
}
#[test]
fn file_dialogue_quest_checked_revision_overflow_rejects_before_any_commit() {
    let mut q = NativeQuestLog::new(&config()).unwrap();
    q.state.borrow_mut().file_revision = u64::MAX;
    let old = qpacket(&q);
    assert!(q.apply(&updates(0, "__proto__", None)).is_err());
    assert!(q.validate_restore(&progress()).is_err());
    assert!(q.restore(&progress()).is_err());
    assert!(NativeDialogueSession::with_quests(&graph(false), &q).is_err());
    assert_eq!(qpacket(&q), old);
    let q = NativeQuestLog::new(&config()).unwrap();
    let mut d = NativeDialogueSession::with_quests(&graph(false), &q).unwrap();
    d.file_revision = u64::MAX;
    let old = dpacket(&d);
    let qb = qpacket(&q);
    assert!(d.choose(0).is_err());
    assert!(d.validate_restore(&dialogue("done", &[], false)).is_err());
    assert!(d.restore(&dialogue("done", &[], false)).is_err());
    assert_eq!(dpacket(&d), old);
    assert_eq!(qpacket(&q), qb);
}
