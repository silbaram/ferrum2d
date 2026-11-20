use super::*;
use crate::engine::file_controller_admission::{Error, Limits};
fn validate(n: &ActorNavigation, work: u64) -> Result {
    let mut b = Budget::new(Limits {
        max_work: work,
        max_scratch_bytes: 0,
    });
    n.validate_file_controller(&mut b)
}
#[test]
fn controller_admission_actor_cursor_numeric_and_history_contracts_are_guard_only() {
    let point = Point {
        pose: Pose::default(),
        surface: 7,
    };
    let source = ActorNavigation::from_route(
        Entity {
            id: 7,
            generation: 2,
        },
        Arc::from([
            point,
            Point {
                pose: Pose {
                    position: [2., 0., 0.],
                    ..Pose::default()
                },
                surface: 7,
            },
        ]),
        2.,
        0.01,
        0.001,
        Pose::default(),
    );
    let original = crate::checkpoint_codec::encode(&source).unwrap();
    validate(&source, 128).unwrap();
    assert_eq!(validate(&source, 127), Err(Error::Work));
    for case in 0..16 {
        let mut bad = source.clone();
        match case {
            0 => bad.next = 2,
            1 => bad.planned = 1,
            2 => bad.points = None,
            3 => bad.status = SpatialMoveStatus::Arrived,
            4 => bad.last = None,
            5 => bad.tolerance = 0.,
            6 => bad.radius = f32::NAN,
            7 => bad.last_motion = Some((f64::INFINITY, 0.)),
            8 => bad.intent_distance = -1.,
            9 => bad.actor = None,
            10 => Arc::make_mut(bad.points.as_mut().unwrap())[0].pose.rotation = [0.; 4],
            11 => Arc::make_mut(bad.points.as_mut().unwrap())[0].surface = 0,
            12 => bad.request_status = 9,
            13 => bad.speed = f32::INFINITY,
            14 => bad.expanded = 4097,
            _ => bad.probes = 32769,
        }
        let bytes = crate::checkpoint_codec::encode(&bad).unwrap();
        let candidate: ActorNavigation = crate::checkpoint_codec::decode(&bytes).unwrap();
        assert!(
            matches!(validate(&candidate, 100_000), Err(Error::Invalid { .. })),
            "case{case}"
        );
        assert_eq!(crate::checkpoint_codec::encode(&candidate).unwrap(), bytes);
        assert_eq!(crate::checkpoint_codec::encode(&source).unwrap(), original);
    }
    let mut history = source;
    history.requests = u32::MAX;
    history.reject_unavailable_request();
    validate(&history, 128).unwrap();
    assert_eq!(history.requests, u32::MAX);
    assert!(history.cancel());
    validate(&history, 96).unwrap();
    assert_eq!(history.planned, 2);
    assert!(history.actor.is_some());
}
