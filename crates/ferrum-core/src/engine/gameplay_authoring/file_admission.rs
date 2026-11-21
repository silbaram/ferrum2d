use super::*;
use crate::components::gameplay::file_payload;
use crate::engine::file_gameplay_authoring_admission::{require, Budget, Error};

/// Borrowed immutable gameplay metadata shared with stored combat definitions.
/// Backing action/reaction/trigger sets are borrowed; no clone, World lookup,
/// re-encoding or candidate installation is involved.
pub(in crate::engine) struct BorrowedGameplayPayload<'a> {
    #[allow(dead_code)] // Resolver/raw serde-valid token, same policy as the snapshot.
    pub(in crate::engine) entity: Entity,
    pub(in crate::engine) health: Option<f32>,
    pub(in crate::engine) damage: Option<f32>,
    pub(in crate::engine) lifetime: Option<f32>,
    #[allow(dead_code)] // Resolver/raw serde-valid token, same policy as the snapshot.
    pub(in crate::engine) score_reward: Option<u32>,
    pub(in crate::engine) faction: Option<GameplayFaction>,
    pub(in crate::engine) tags: Option<GameplayTags>,
    #[allow(dead_code)] // Resolver/raw serde-valid token, same policy as the snapshot.
    pub(in crate::engine) pickup: Option<Pickup>,
    pub(in crate::engine) interaction: Option<Interaction>,
    pub(in crate::engine) timer_trigger: Option<GameplayTimerTrigger>,
    pub(in crate::engine) movement: Option<MovementPattern>,
    pub(in crate::engine) actions: Option<&'a ActionBindingSet>,
    pub(in crate::engine) collision_reactions: Option<&'a CollisionReactionSet>,
    pub(in crate::engine) variable_mutation_triggers:
        Option<&'a GameplayVariableMutationTriggerSet>,
}
impl BorrowedGameplayPayload<'_> {
    pub(in crate::engine) fn validate_with_charge(
        &self,
        mut charge: impl FnMut(u64) -> Result<(), Error>,
    ) -> Result<(), Error> {
        let Self {
            entity: _,
            health: _,
            damage: _,
            lifetime: _,
            score_reward: _,
            faction: _,
            tags: _,
            pickup: _,
            interaction: _,
            timer_trigger: _,
            movement: _,
            actions: _,
            collision_reactions: _,
            variable_mutation_triggers: _,
        } = self;
        charge(14)?;
        // entity is a resolver-safe historical token. A public authoring
        // capture can outlive despawn/reuse/reset; restore checks the handle.
        for (field, value) in [
            ("health", self.health),
            ("damage", self.damage),
            ("lifetime", self.lifetime),
        ] {
            if let Some(value) = value {
                charge(2)?;
                require(value.is_finite(), field, 0)?;
            }
        }
        if let Some(faction) = self.faction {
            charge(4)?;
            require(faction.faction_id <= GAMEPLAY_FACTION_MAX_ID, "faction", 0)?;
        }
        if let Some(tags) = self.tags {
            charge(4)?;
            require(tags.mask != 0, "tags", 0)?;
        }
        // Raw score_reward and Pickup integer/boolean payloads are serde-valid
        // tokens, matching the existing World admission policy.
        if let Some(interaction) = self.interaction {
            charge(16)?;
            require(
                interaction.radius.is_finite() && interaction.guard.saved_payload_valid(),
                "interaction",
                0,
            )?;
        }
        if let Some(timer) = self.timer_trigger {
            charge(32)?;
            require(
                timer.duration_seconds.is_finite()
                    && timer.remaining_seconds.is_finite()
                    && timer.guard.saved_payload_valid(),
                "timer",
                0,
            )?;
        }
        if let Some(movement) = self.movement {
            charge(32)?;
            require(file_payload::movement(movement), "movement", 0)?;
        }
        if let Some(actions) = &self.actions {
            charge(1024)?;
            require(actions.admit_saved_layout().is_ok(), "actions.layout", 0)?;
            for (index, binding) in actions.saved_bindings().enumerate() {
                require(
                    file_payload::cooldown(binding.cooldown)
                        && file_payload::action(binding.pattern),
                    "actions.payload",
                    index,
                )?;
            }
        }
        if let Some(reactions) = &self.collision_reactions {
            charge(2048)?;
            require(
                reactions.admit_saved_layout().is_ok(),
                "reactions.layout",
                0,
            )?;
            for (index, reaction) in reactions.checkpoint_reactions().enumerate() {
                require(file_payload::reaction(reaction), "reactions.payload", index)?;
            }
        }
        if let Some(triggers) = &self.variable_mutation_triggers {
            charge(1024)?;
            require(
                triggers.admit_saved_layout().is_ok(),
                "variable-triggers",
                0,
            )?;
        }
        Ok(())
    }
}
impl GameplayAuthoringSnapshot {
    pub(in crate::engine) fn validate_file(&self, budget: &mut Budget) -> Result<(), Error> {
        BorrowedGameplayPayload {
            entity: self.entity,
            health: self.health,
            damage: self.damage,
            lifetime: self.lifetime,
            score_reward: self.score_reward,
            faction: self.faction,
            tags: self.tags,
            pickup: self.pickup,
            interaction: self.interaction,
            timer_trigger: self.timer_trigger,
            movement: self.movement,
            actions: self.actions.as_ref(),
            collision_reactions: self.collision_reactions.as_ref(),
            variable_mutation_triggers: self.variable_mutation_triggers.as_ref(),
        }
        .validate_with_charge(|amount| budget.work(amount))
    }
}

#[cfg(test)]
impl GameplayAuthoringSnapshot {
    pub(in crate::engine) fn corrupt_file_authoring_snapshot_fixture(&mut self, case: u32) {
        fn oversized_len<T: serde::Serialize + serde::de::DeserializeOwned + Default>() -> T {
            let mut payload = postcard::to_allocvec(&T::default()).unwrap();
            assert_eq!(
                payload.last(),
                Some(&0),
                "default packed count is the final zero"
            );
            *payload.last_mut().unwrap() = 127;
            crate::checkpoint_decode::from_bytes(&payload).unwrap()
        }
        fn bad_guard() -> crate::gameplay_variables::GameplayVariableComparison {
            let mut payload = postcard::to_allocvec(
                &crate::gameplay_variables::GameplayVariableComparison::always(),
            )
            .unwrap();
            let end = payload.len();
            assert_eq!(&payload[end - 8..], &[0; 8]);
            payload[end - 8..].copy_from_slice(&f64::NAN.to_le_bytes());
            crate::checkpoint_decode::from_bytes(&payload).unwrap()
        }
        match case {
            0 => self.health = Some(f32::NAN),
            1 => self.damage = Some(f32::INFINITY),
            2 => self.lifetime = Some(f32::NAN),
            3 => {
                self.faction = Some(GameplayFaction {
                    faction_id: 32,
                    damage_mask: u32::MAX,
                })
            }
            4 => self.tags = Some(GameplayTags { mask: 0 }),
            5 => self.interaction = Some(Interaction::new(1, f32::NAN, false)),
            6 => self.timer_trigger = Some(GameplayTimerTrigger::new(1, f32::INFINITY)),
            7 => {
                self.movement = Some(MovementPattern::Linear {
                    vx: f32::NAN,
                    vy: 0.0,
                })
            }
            8 => {
                let mut actions = ActionBindingSet::default();
                assert!(actions.upsert(ActionBinding::projectile(1, f32::NAN, 1.0, 1.0, 1.0)));
                self.actions = Some(actions);
            }
            9 => self.actions = Some(oversized_len::<ActionBindingSet>()),
            10 => {
                let mut reactions = CollisionReactionSet::default();
                assert!(reactions.push(CollisionReaction::Knockback {
                    target: CollisionTarget::OtherEntity,
                    impulse: f32::NAN
                }));
                self.collision_reactions = Some(reactions);
            }
            11 => self.collision_reactions = Some(oversized_len::<CollisionReactionSet>()),
            12 => {
                self.variable_mutation_triggers =
                    Some(oversized_len::<GameplayVariableMutationTriggerSet>())
            }
            13 => {
                let mut v = Interaction::new(1, 1.0, false);
                v.guard = bad_guard();
                self.interaction = Some(v);
            }
            14 => {
                let mut v = GameplayTimerTrigger::new(1, 1.0);
                v.guard = bad_guard();
                self.timer_trigger = Some(v);
            }
            15 => {
                self.movement = Some(MovementPattern::Chase {
                    target: MovementTarget::NearestFaction(32),
                    speed: 1.0,
                })
            }
            _ => unreachable!("known authoring snapshot test case"),
        }
    }

    pub(in crate::engine) fn raw_file_authoring_snapshot_fixture(&mut self) {
        self.health = Some(-17.0);
        self.damage = Some(-0.0);
        self.lifetime = Some(-f32::MAX);
        self.score_reward = Some(u32::MAX);
        self.pickup = Some(Pickup::new(0, 0, false));
        self.movement = Some(MovementPattern::Chase {
            target: MovementTarget::Entity(Entity {
                id: u32::MAX,
                generation: u32::MAX,
            }),
            speed: -3.0,
        });
    }
}
