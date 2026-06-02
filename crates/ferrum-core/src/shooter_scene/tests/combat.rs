use super::*;

#[test]
fn bullet_lifetime_despawns() {
    let (mut scene, mut world, _, _) = playing_scene();
    let b = world.spawn_bullet(30.0, 30.0, 10.0, 0.0, DEFAULT_TEXTURE_ID);

    scene.update_bullets(&mut world, crate::world::BULLET_LIFETIME + 0.1);

    assert!(!world.alive[b.id as usize]);
}

#[test]
fn authored_non_bullet_lifetime_despawns() {
    let (mut scene, mut world, _, _) = playing_scene();
    let enemy = world.spawn_enemy(30.0, 30.0, DEFAULT_TEXTURE_ID);
    world.bullet_lifetimes[enemy.id as usize] = Some(0.25);

    scene.update_bullets(&mut world, 0.26);

    assert!(!world.alive[enemy.id as usize]);
}

#[test]
fn bullet_enemy_collision_increments_score() {
    let (mut scene, mut world, _, mut audio_events) = playing_scene();
    let b = world.spawn_bullet(50.0, 50.0, 0.0, 0.0, DEFAULT_TEXTURE_ID);
    let e = world.spawn_enemy(52.0, 50.0, DEFAULT_TEXTURE_ID);

    scene.handle_collisions(
        &mut world,
        &Tilemap::default(),
        &mut audio_events,
        0.0,
        None,
        None,
        None,
        None,
    );

    assert!(!world.alive[b.id as usize]);
    assert!(!world.alive[e.id as usize]);
    assert_eq!(scene.score(), 1);
}

#[test]
fn bullet_enemy_zero_reward_kill_does_not_flash_enemy_hit() {
    let (mut scene, mut world, _, mut audio_events) = playing_scene();
    let mut tweens = TweenSystem::new();
    let bullet = world.spawn_bullet(50.0, 50.0, 0.0, 0.0, DEFAULT_TEXTURE_ID);
    let enemy = world.spawn_enemy(52.0, 50.0, DEFAULT_TEXTURE_ID);
    world.score_rewards[enemy.id as usize] = Some(0);

    {
        let mut tween_sink = TweenSink::new(&mut tweens);
        scene.handle_collisions(
            &mut world,
            &Tilemap::default(),
            &mut audio_events,
            0.0,
            None,
            None,
            None,
            Some(&mut tween_sink),
        );
    }

    assert!(!world.alive[bullet.id as usize]);
    assert!(!world.alive[enemy.id as usize]);
    assert_eq!(scene.score(), 0);
    assert_eq!(tweens.tween_count(), 0);
}

#[test]
fn pending_melee_attacks_skip_enemy_marked_by_earlier_melee() {
    let (mut scene, mut world, _, mut audio_events) = playing_scene();
    let player = world.player.unwrap();
    let player_t = world.transform(player).unwrap();
    let enemy = world.spawn_enemy(player_t.x + 16.0, player_t.y, DEFAULT_TEXTURE_ID);
    world.healths[enemy.id as usize] = Some(1.0);
    let attack = crate::gameplay::MeleeAttackCoreData {
        attacker: player,
        center: player_t,
        range: 32.0,
        damage: 1.0,
        target: MeleeTarget::Enemies,
        height_span: None,
    };

    scene.queue_melee_attack(attack);
    scene.queue_melee_attack(attack);
    scene.handle_collisions(
        &mut world,
        &Tilemap::default(),
        &mut audio_events,
        0.0,
        None,
        None,
        None,
        None,
    );

    assert!(!world.alive[enemy.id as usize]);
    assert_eq!(scene.score(), DEFAULT_SCORE_REWARD);
    assert!(scene.pending_melee_attacks.is_empty());
}

#[test]
fn pending_melee_enemy_hit_uses_custom_reward_and_damage_event_removed_flag() {
    let (mut scene, mut world, _, mut audio_events) = playing_scene();
    let mut gameplay_events = Vec::new();
    let player = world.player.unwrap();
    let player_t = world.transform(player).unwrap();
    let enemy = world.spawn_enemy(player_t.x + 16.0, player_t.y, DEFAULT_TEXTURE_ID);
    world.healths[enemy.id as usize] = Some(1.0);
    world.score_rewards[enemy.id as usize] = Some(7);
    scene.queue_melee_attack(crate::gameplay::MeleeAttackCoreData {
        attacker: player,
        center: player_t,
        range: 32.0,
        damage: 1.0,
        target: MeleeTarget::Enemies,
        height_span: None,
    });

    {
        let mut gameplay_sink = GameplayEventSink::new(&mut gameplay_events);
        scene.handle_collisions(
            &mut world,
            &Tilemap::default(),
            &mut audio_events,
            0.0,
            None,
            Some(&mut gameplay_sink),
            None,
            None,
        );
    }

    assert!(!world.alive[enemy.id as usize]);
    assert_eq!(scene.score(), 7);
    assert_eq!(gameplay_events.len(), 1);
    assert_eq!(gameplay_events[0].kind, GAMEPLAY_EVENT_COLLISION_DAMAGE);
    assert_eq!(gameplay_events[0].actor_id, enemy.id);
    assert_eq!(gameplay_events[0].source_id, player.id);
    assert_eq!(gameplay_events[0].payload_bits, 1.0_f32.to_bits());
    assert_eq!(
        gameplay_events[0].flags & GAMEPLAY_EVENT_FLAG_TARGET_REMOVED,
        GAMEPLAY_EVENT_FLAG_TARGET_REMOVED,
    );
}

#[test]
fn pending_non_player_enemy_target_melee_damages_other_enemy_without_self_hit() {
    let (mut scene, mut world, _, mut audio_events) = playing_scene();
    let source = world.spawn_enemy(50.0, 50.0, DEFAULT_TEXTURE_ID);
    let target = world.spawn_enemy(56.0, 50.0, DEFAULT_TEXTURE_ID);
    let source_t = world.transform(source).unwrap();
    let mut gameplay_events = Vec::new();
    let attack = crate::gameplay::MeleeAttackCoreData {
        attacker: source,
        center: source_t,
        range: 16.0,
        damage: 1.0,
        target: MeleeTarget::Enemies,
        height_span: None,
    };

    scene.queue_melee_attack(attack);
    {
        let mut gameplay_sink = GameplayEventSink::new(&mut gameplay_events);
        scene.handle_collisions(
            &mut world,
            &Tilemap::default(),
            &mut audio_events,
            0.0,
            None,
            Some(&mut gameplay_sink),
            None,
            None,
        );
    }

    assert!(world.alive[source.id as usize]);
    assert!(!world.alive[target.id as usize]);
    assert_eq!(world.healths[source.id as usize], Some(1.0));
    assert_eq!(scene.score(), 1);
    assert_eq!(gameplay_events.len(), 1);
    assert_eq!(gameplay_events[0].kind, GAMEPLAY_EVENT_COLLISION_DAMAGE);
    assert_eq!(gameplay_events[0].actor_id, target.id);
    assert_eq!(gameplay_events[0].source_id, source.id);
    assert_eq!(
        gameplay_events[0].flags & GAMEPLAY_EVENT_FLAG_TARGET_REMOVED,
        GAMEPLAY_EVENT_FLAG_TARGET_REMOVED,
    );
}

#[test]
fn pending_non_player_enemy_target_melee_faction_denial_reports_without_hit() {
    let (mut scene, mut world, _, mut audio_events) = playing_scene();
    let source = world.spawn_enemy(50.0, 50.0, DEFAULT_TEXTURE_ID);
    let target = world.spawn_enemy(56.0, 50.0, DEFAULT_TEXTURE_ID);
    let source_t = world.transform(source).unwrap();
    world.set_gameplay_faction(
        source,
        GameplayFaction::new(GAMEPLAY_FACTION_ENEMY, 0).unwrap(),
    );
    world.set_gameplay_faction(
        target,
        GameplayFaction::new(GAMEPLAY_FACTION_ENEMY, 1 << GAMEPLAY_FACTION_PLAYER).unwrap(),
    );
    let mut gameplay_events = Vec::new();
    let mut collision_events = Vec::new();
    let mut collision_event_counts = crate::collision_event::CollisionEventCounts::default();
    let attack = crate::gameplay::MeleeAttackCoreData {
        attacker: source,
        center: source_t,
        range: 16.0,
        damage: 1.0,
        target: MeleeTarget::Enemies,
        height_span: None,
    };

    scene.queue_melee_attack(attack);
    {
        let mut gameplay_sink = GameplayEventSink::new(&mut gameplay_events);
        let mut collision_sink =
            CollisionEventSink::new(&mut collision_events, &mut collision_event_counts);
        scene.handle_collisions(
            &mut world,
            &Tilemap::default(),
            &mut audio_events,
            0.0,
            Some(&mut collision_sink),
            Some(&mut gameplay_sink),
            None,
            None,
        );
    }

    assert!(world.alive[source.id as usize]);
    assert!(world.alive[target.id as usize]);
    assert_eq!(world.healths[target.id as usize], Some(1.0));
    assert_eq!(scene.score(), 0);
    assert!(collision_events.is_empty());
    assert_eq!(collision_event_counts.hit, 0);
    assert!(audio_events.is_empty());
    assert_eq!(gameplay_events.len(), 1);
    assert_eq!(
        gameplay_events[0].kind,
        GAMEPLAY_EVENT_FACTION_DAMAGE_DENIED
    );
    assert_eq!(gameplay_events[0].actor_id, target.id);
    assert_eq!(gameplay_events[0].source_id, source.id);
    assert_eq!(gameplay_events[0].token_id, GAMEPLAY_FACTION_ENEMY);
    assert_eq!(gameplay_events[0].payload_bits, GAMEPLAY_FACTION_ENEMY);
}

#[test]
fn pending_melee_enemy_hit_records_collision_hit_event() {
    let (mut scene, mut world, _, mut audio_events) = playing_scene();
    let player = world.player.unwrap();
    let player_t = world.transform(player).unwrap();
    let enemy = world.spawn_enemy(player_t.x + 16.0, player_t.y, DEFAULT_TEXTURE_ID);
    world.healths[enemy.id as usize] = Some(1.0);
    scene.queue_melee_attack(crate::gameplay::MeleeAttackCoreData {
        attacker: player,
        center: player_t,
        range: 32.0,
        damage: 1.0,
        target: MeleeTarget::Enemies,
        height_span: None,
    });
    let mut collision_events = Vec::new();
    let mut collision_event_counts = crate::collision_event::CollisionEventCounts::default();

    {
        let mut collision_sink =
            CollisionEventSink::new(&mut collision_events, &mut collision_event_counts);
        scene.handle_collisions(
            &mut world,
            &Tilemap::default(),
            &mut audio_events,
            0.0,
            Some(&mut collision_sink),
            None,
            None,
            None,
        );
    }

    assert_eq!(collision_event_counts.hit, 1);
    assert_eq!(collision_events.len(), 1);
    assert_eq!(
        collision_events[0].kind,
        crate::collision_event::COLLISION_EVENT_HIT,
    );
    assert_eq!(collision_events[0].a_id, player.id);
    assert_eq!(collision_events[0].a_generation, player.generation);
    assert_eq!(collision_events[0].b_id, enemy.id);
    assert_eq!(collision_events[0].b_generation, enemy.generation);
    assert_eq!(collision_events[0].damage(), 1.0);
}

#[test]
fn pending_melee_enemy_hit_pushes_hit_audio_event() {
    let (mut scene, mut world, _, mut audio_events) = playing_scene();
    scene.set_sound_ids(10, 20, 30);
    scene.set_audio_policy(ShooterAudioPolicy::from_values(
        0.2, 1.2, 0.5, 1.25, 0.8, 0.7,
    ));
    let player = world.player.unwrap();
    let player_t = world.transform(player).unwrap();
    let enemy = world.spawn_enemy(player_t.x + 16.0, player_t.y, DEFAULT_TEXTURE_ID);
    world.healths[enemy.id as usize] = Some(1.0);
    scene.queue_melee_attack(crate::gameplay::MeleeAttackCoreData {
        attacker: player,
        center: player_t,
        range: 32.0,
        damage: 1.0,
        target: MeleeTarget::Enemies,
        height_span: None,
    });

    scene.handle_collisions(
        &mut world,
        &Tilemap::default(),
        &mut audio_events,
        0.0,
        None,
        None,
        None,
        None,
    );

    assert!(!world.alive[enemy.id as usize]);
    assert_eq!(audio_events.len(), 1);
    assert_eq!(audio_events[0].sound_id as u32, 20);
    assert_eq!(audio_events[0].volume, 0.5);
    assert_eq!(audio_events[0].pitch, 1.25);
    assert_eq!(audio_events[0].channel_id, AUDIO_CHANNEL_SFX);
}

#[test]
fn pending_melee_enemy_hit_skips_default_sound_id_audio() {
    let (mut scene, mut world, _, mut audio_events) = playing_scene();
    let player = world.player.unwrap();
    let player_t = world.transform(player).unwrap();
    let enemy = world.spawn_enemy(player_t.x + 16.0, player_t.y, DEFAULT_TEXTURE_ID);
    world.healths[enemy.id as usize] = Some(1.0);
    scene.queue_melee_attack(crate::gameplay::MeleeAttackCoreData {
        attacker: player,
        center: player_t,
        range: 32.0,
        damage: 1.0,
        target: MeleeTarget::Enemies,
        height_span: None,
    });

    scene.handle_collisions(
        &mut world,
        &Tilemap::default(),
        &mut audio_events,
        0.0,
        None,
        None,
        None,
        None,
    );

    assert!(!world.alive[enemy.id as usize]);
    assert!(audio_events.is_empty());
}

#[test]
fn pending_melee_zero_reward_kill_does_not_flash_enemy_hit() {
    let (mut scene, mut world, _, mut audio_events) = playing_scene();
    let mut tweens = TweenSystem::new();
    let player = world.player.unwrap();
    let player_t = world.transform(player).unwrap();
    let enemy = world.spawn_enemy(player_t.x + 16.0, player_t.y, DEFAULT_TEXTURE_ID);
    world.healths[enemy.id as usize] = Some(1.0);
    world.score_rewards[enemy.id as usize] = Some(0);
    scene.queue_melee_attack(crate::gameplay::MeleeAttackCoreData {
        attacker: player,
        center: player_t,
        range: 32.0,
        damage: 1.0,
        target: MeleeTarget::Enemies,
        height_span: None,
    });

    {
        let mut tween_sink = TweenSink::new(&mut tweens);
        scene.handle_collisions(
            &mut world,
            &Tilemap::default(),
            &mut audio_events,
            0.0,
            None,
            None,
            None,
            Some(&mut tween_sink),
        );
    }

    assert!(!world.alive[enemy.id as usize]);
    assert_eq!(scene.score(), 0);
    assert_eq!(tweens.tween_count(), 0);
}

#[test]
fn bullet_without_collision_target_metadata_defaults_to_enemy_target() {
    let (mut scene, mut world, _, mut audio_events) = playing_scene();
    let b = world.spawn_bullet(50.0, 50.0, 0.0, 0.0, DEFAULT_TEXTURE_ID);
    let e = world.spawn_enemy(52.0, 50.0, DEFAULT_TEXTURE_ID);
    world.projectile_collision_targets[b.id as usize] = None;

    scene.handle_collisions(
        &mut world,
        &Tilemap::default(),
        &mut audio_events,
        0.0,
        None,
        None,
        None,
        None,
    );

    assert!(!world.alive[b.id as usize]);
    assert!(!world.alive[e.id as usize]);
    assert_eq!(scene.score(), 1);
}

#[test]
fn default_bullet_enemy_damage_respects_gameplay_faction_damage_mask() {
    let (mut scene, mut world, _, mut audio_events) = playing_scene();
    let mut gameplay_events = Vec::new();
    let b = world.spawn_bullet(50.0, 50.0, 0.0, 0.0, DEFAULT_TEXTURE_ID);
    let e = world.spawn_enemy(52.0, 50.0, DEFAULT_TEXTURE_ID);
    world.set_gameplay_faction(b, GameplayFaction::new(GAMEPLAY_FACTION_PLAYER, 0).unwrap());
    world.set_gameplay_faction(
        e,
        GameplayFaction::new(GAMEPLAY_FACTION_ENEMY, 1 << GAMEPLAY_FACTION_PLAYER).unwrap(),
    );

    {
        let mut gameplay_sink = GameplayEventSink::new(&mut gameplay_events);
        scene.handle_collisions(
            &mut world,
            &Tilemap::default(),
            &mut audio_events,
            0.0,
            None,
            Some(&mut gameplay_sink),
            None,
            None,
        );
    }

    assert!(world.alive[b.id as usize]);
    assert!(world.alive[e.id as usize]);
    assert_eq!(world.healths[e.id as usize], Some(1.0));
    assert_eq!(scene.score(), 0);
    assert!(audio_events.is_empty());
    assert_eq!(gameplay_events.len(), 1);
    assert_eq!(
        gameplay_events[0].kind,
        GAMEPLAY_EVENT_FACTION_DAMAGE_DENIED
    );
    assert_eq!(gameplay_events[0].actor_id, e.id);
    assert_eq!(gameplay_events[0].source_id, b.id);
    assert_eq!(gameplay_events[0].token_id, GAMEPLAY_FACTION_PLAYER);
    assert_eq!(gameplay_events[0].payload_bits, GAMEPLAY_FACTION_ENEMY);
}

#[test]
fn default_bullet_enemy_damage_neutral_source_reports_denial() {
    let (mut scene, mut world, _, mut audio_events) = playing_scene();
    let mut gameplay_events = Vec::new();
    let mut collision_events = Vec::new();
    let mut collision_event_counts = crate::collision_event::CollisionEventCounts::default();
    let mut hit_preset = ParticlePreset::new(DEFAULT_TEXTURE_ID);
    hit_preset.burst_count = 2;
    let mut particles = ParticleSystem::with_capacity(8);
    let mut tweens = TweenSystem::new();
    let bullet = world.spawn_bullet(50.0, 50.0, 0.0, 0.0, DEFAULT_TEXTURE_ID);
    let enemy = world.spawn_enemy(52.0, 50.0, DEFAULT_TEXTURE_ID);
    world.set_gameplay_faction(
        bullet,
        GameplayFaction::new(GAMEPLAY_FACTION_NEUTRAL, 0).unwrap(),
    );
    world.set_gameplay_faction(
        enemy,
        GameplayFaction::new(GAMEPLAY_FACTION_ENEMY, 1 << GAMEPLAY_FACTION_PLAYER).unwrap(),
    );

    {
        let mut collision_sink =
            CollisionEventSink::new(&mut collision_events, &mut collision_event_counts);
        let mut gameplay_sink = GameplayEventSink::new(&mut gameplay_events);
        let mut particle_sink =
            ParticleBurstSink::with_presets(&mut particles, Some(hit_preset), &[]);
        let mut tween_sink = TweenSink::new(&mut tweens);
        scene.handle_collisions(
            &mut world,
            &Tilemap::default(),
            &mut audio_events,
            0.0,
            Some(&mut collision_sink),
            Some(&mut gameplay_sink),
            Some(&mut particle_sink),
            Some(&mut tween_sink),
        );
    }

    assert!(world.alive[bullet.id as usize]);
    assert!(world.alive[enemy.id as usize]);
    assert_eq!(world.healths[enemy.id as usize], Some(1.0));
    assert_eq!(scene.score(), 0);
    assert!(collision_events.is_empty());
    assert_eq!(collision_event_counts.hit, 0);
    assert!(audio_events.is_empty());
    assert_eq!(particles.particle_count(), 0);
    assert_eq!(tweens.tween_count(), 0);
    assert_eq!(gameplay_events.len(), 1);
    assert_eq!(
        gameplay_events[0].kind,
        GAMEPLAY_EVENT_FACTION_DAMAGE_DENIED
    );
    assert_eq!(gameplay_events[0].actor_id, enemy.id);
    assert_eq!(gameplay_events[0].source_id, bullet.id);
    assert_eq!(gameplay_events[0].token_id, GAMEPLAY_FACTION_NEUTRAL);
    assert_eq!(gameplay_events[0].payload_bits, GAMEPLAY_FACTION_ENEMY);
}

#[test]
fn player_target_projectile_causes_game_over_without_score() {
    let (mut scene, mut world, _, mut audio_events) = playing_scene();
    let player = world.player_entity().unwrap();
    let player_t = world.transform(player).unwrap();
    let bullet = world.spawn_bullet_from_request(crate::world::BulletSpawnRequest {
        transform: Transform2D {
            x: player_t.x,
            y: player_t.y,
        },
        velocity: Velocity { vx: 0.0, vy: 0.0 },
        texture_id: DEFAULT_TEXTURE_ID,
        lifetime: 1.0,
        template: scene.config.bullet_template,
        damage: 1.0,
        collision_target: ProjectileCollisionTarget::Player,
        tile_impact: ProjectileTileImpact::Despawn,
        source_faction: None,
    });

    scene.handle_collisions(
        &mut world,
        &Tilemap::default(),
        &mut audio_events,
        0.0,
        None,
        None,
        None,
        None,
    );

    assert!(!world.alive[bullet.id as usize]);
    assert_eq!(scene.game_state(), GameState::GameOver);
    assert_eq!(scene.score(), 0);
}

#[test]
fn default_bullet_player_damage_respects_gameplay_faction_damage_mask() {
    let (mut scene, mut world, _, mut audio_events) = playing_scene();
    let mut gameplay_events = Vec::new();
    let player = world.player_entity().unwrap();
    let player_t = world.transform(player).unwrap();
    let bullet = world.spawn_bullet_from_request(crate::world::BulletSpawnRequest {
        transform: Transform2D {
            x: player_t.x,
            y: player_t.y,
        },
        velocity: Velocity { vx: 0.0, vy: 0.0 },
        texture_id: DEFAULT_TEXTURE_ID,
        lifetime: 1.0,
        template: scene.config.bullet_template,
        damage: 1.0,
        collision_target: ProjectileCollisionTarget::Player,
        tile_impact: ProjectileTileImpact::Despawn,
        source_faction: Some(GameplayFaction::new(GAMEPLAY_FACTION_ENEMY, 0).unwrap()),
    });
    world.set_gameplay_faction(
        player,
        GameplayFaction::new(GAMEPLAY_FACTION_PLAYER, 1 << GAMEPLAY_FACTION_ENEMY).unwrap(),
    );

    {
        let mut gameplay_sink = GameplayEventSink::new(&mut gameplay_events);
        scene.handle_collisions(
            &mut world,
            &Tilemap::default(),
            &mut audio_events,
            0.0,
            None,
            Some(&mut gameplay_sink),
            None,
            None,
        );
    }

    assert!(world.alive[bullet.id as usize]);
    assert_eq!(scene.game_state(), GameState::Playing);
    assert_eq!(scene.score(), 0);
    assert!(audio_events.is_empty());
    assert_eq!(gameplay_events.len(), 1);
    assert_eq!(
        gameplay_events[0].kind,
        GAMEPLAY_EVENT_FACTION_DAMAGE_DENIED
    );
    assert_eq!(gameplay_events[0].actor_id, player.id);
    assert_eq!(gameplay_events[0].source_id, bullet.id);
    assert_eq!(gameplay_events[0].token_id, GAMEPLAY_FACTION_ENEMY);
    assert_eq!(gameplay_events[0].payload_bits, GAMEPLAY_FACTION_PLAYER);
}

#[test]
fn enemy_target_projectile_does_not_hit_player() {
    let (mut scene, mut world, _, mut audio_events) = playing_scene();
    let mut gameplay_events = Vec::new();
    let player = world.player_entity().unwrap();
    let player_t = world.transform(player).unwrap();
    let bullet = world.spawn_bullet_from_request(crate::world::BulletSpawnRequest {
        transform: Transform2D {
            x: player_t.x,
            y: player_t.y,
        },
        velocity: Velocity { vx: 0.0, vy: 0.0 },
        texture_id: DEFAULT_TEXTURE_ID,
        lifetime: 1.0,
        template: scene.config.bullet_template,
        damage: 1.0,
        collision_target: ProjectileCollisionTarget::Enemies,
        tile_impact: ProjectileTileImpact::Despawn,
        source_faction: Some(GameplayFaction::new(GAMEPLAY_FACTION_PLAYER, 0).unwrap()),
    });
    world.set_gameplay_faction(
        player,
        GameplayFaction::new(GAMEPLAY_FACTION_PLAYER, 1 << GAMEPLAY_FACTION_ENEMY).unwrap(),
    );

    {
        let mut gameplay_sink = GameplayEventSink::new(&mut gameplay_events);
        scene.handle_collisions(
            &mut world,
            &Tilemap::default(),
            &mut audio_events,
            0.0,
            None,
            Some(&mut gameplay_sink),
            None,
            None,
        );
    }

    assert!(world.alive[bullet.id as usize]);
    assert_eq!(scene.game_state(), GameState::Playing);
    assert!(gameplay_events.is_empty());
}

#[test]
fn fast_bullet_enemy_collision_uses_swept_physics() {
    let (mut scene, mut world, _, mut audio_events) = playing_scene();
    let b = world.spawn_bullet(0.0, 50.0, 1000.0, 0.0, DEFAULT_TEXTURE_ID);
    let e = world.spawn_enemy(50.0, 50.0, DEFAULT_TEXTURE_ID);

    world.update(0.1);
    assert!(!CollisionSystem::overlaps(
        world.transforms[b.id as usize].unwrap(),
        world.colliders[b.id as usize].unwrap(),
        world.transforms[e.id as usize].unwrap(),
        world.colliders[e.id as usize].unwrap(),
    ));

    scene.handle_collisions(
        &mut world,
        &Tilemap::default(),
        &mut audio_events,
        0.1,
        None,
        None,
        None,
        None,
    );

    assert!(!world.alive[b.id as usize]);
    assert!(!world.alive[e.id as usize]);
    assert_eq!(scene.score(), 1);
}

#[test]
fn bullet_enemy_collision_requires_overlapping_height_span_when_authored() {
    let (mut scene, mut world, _, mut audio_events) = playing_scene();
    let b = world.spawn_bullet(50.0, 50.0, 0.0, 0.0, DEFAULT_TEXTURE_ID);
    let e = world.spawn_enemy(52.0, 50.0, DEFAULT_TEXTURE_ID);
    assert!(world.set_height_span(b, HeightSpan::new(PhysicsFloorId(1), 16.0, 2.0).unwrap(),));
    assert!(world.set_height_span(e, HeightSpan::new(PhysicsFloorId(1), 0.0, 8.0).unwrap(),));

    scene.handle_collisions(
        &mut world,
        &Tilemap::default(),
        &mut audio_events,
        0.0,
        None,
        None,
        None,
        None,
    );

    assert!(world.alive[b.id as usize]);
    assert!(world.alive[e.id as usize]);
    assert_eq!(scene.score(), 0);

    assert!(world.set_height_span(b, HeightSpan::new(PhysicsFloorId(1), 6.0, 2.0).unwrap(),));
    scene.handle_collisions(
        &mut world,
        &Tilemap::default(),
        &mut audio_events,
        0.0,
        None,
        None,
        None,
        None,
    );

    assert!(!world.alive[b.id as usize]);
    assert!(!world.alive[e.id as usize]);
    assert_eq!(scene.score(), 1);
}

#[test]
fn projectile_arc_updates_bullet_height_span_before_combat() {
    let (mut scene, mut world, _, mut audio_events) = playing_scene();
    let b = world.spawn_bullet(50.0, 50.0, 0.0, 0.0, DEFAULT_TEXTURE_ID);
    let e = world.spawn_enemy(52.0, 50.0, DEFAULT_TEXTURE_ID);
    assert!(world.set_height_span(e, HeightSpan::new(PhysicsFloorId(1), 8.0, 4.0).unwrap(),));
    assert!(world.set_projectile_arc(
        b,
        ProjectileArc::new(PhysicsFloorId(1), 0.0, 0.0, 100.0, 0.0, 1.0).unwrap(),
    ));

    scene.update_bullets(&mut world, 0.1);
    assert_eq!(
        world.height_span(b),
        HeightSpan::new(PhysicsFloorId(1), 10.0, 1.0),
    );
    scene.handle_collisions(
        &mut world,
        &Tilemap::default(),
        &mut audio_events,
        0.0,
        None,
        None,
        None,
        None,
    );

    assert!(!world.alive[b.id as usize]);
    assert!(!world.alive[e.id as usize]);
    assert_eq!(scene.score(), 1);
}

#[test]
fn bullet_is_despawned_by_projectile_blocking_tile() {
    let (mut scene, mut world, _, mut audio_events) = playing_scene();
    let bullet = world.spawn_bullet(40.0, 50.0, 200.0, 0.0, DEFAULT_TEXTURE_ID);
    let tilemap = projectile_tilemap(true, None);

    world.update(0.1);
    scene.handle_collisions(
        &mut world,
        &tilemap,
        &mut audio_events,
        0.1,
        None,
        None,
        None,
        None,
    );

    assert!(!world.alive[bullet.id as usize]);
}

#[test]
fn tile_hit_marks_bullet_before_enemy_damage() {
    let (mut scene, mut world, mut camera, mut audio_events) = playing_scene();
    scene.set_combat(&mut world, &mut camera, &mut audio_events, 3.0, 1.0, 5);
    let bullet = world.spawn_bullet(40.0, 50.0, 200.0, 0.0, DEFAULT_TEXTURE_ID);
    let enemy = world.spawn_enemy_from_template(
        62.0,
        50.0,
        DEFAULT_TEXTURE_ID,
        scene.config.enemy_template,
        scene.config.enemy_health,
        scene.config.score_reward,
    );
    let tilemap = projectile_tilemap(true, None);

    world.update(0.1);
    scene.handle_collisions(
        &mut world,
        &tilemap,
        &mut audio_events,
        0.1,
        None,
        None,
        None,
        None,
    );

    assert!(!world.alive[bullet.id as usize]);
    assert!(world.alive[enemy.id as usize]);
    assert_eq!(world.healths[enemy.id as usize], Some(3.0));
    assert_eq!(scene.score(), 0);
}

#[test]
fn pass_through_projectile_ignores_blocking_tile() {
    let (mut scene, mut world, _, mut audio_events) = playing_scene();
    let bullet = world.spawn_bullet(40.0, 50.0, 200.0, 0.0, DEFAULT_TEXTURE_ID);
    world.projectile_tile_impacts[bullet.id as usize] = Some(ProjectileTileImpact::PassThrough);
    let tilemap = projectile_tilemap(true, None);

    world.update(0.1);
    scene.handle_collisions(
        &mut world,
        &tilemap,
        &mut audio_events,
        0.1,
        None,
        None,
        None,
        None,
    );

    assert!(world.alive[bullet.id as usize]);
}

#[test]
fn pass_through_projectile_can_hit_enemy_after_blocking_tile() {
    let (mut scene, mut world, mut camera, mut audio_events) = playing_scene();
    scene.set_combat(&mut world, &mut camera, &mut audio_events, 3.0, 1.0, 5);
    let bullet = world.spawn_bullet(40.0, 50.0, 200.0, 0.0, DEFAULT_TEXTURE_ID);
    world.projectile_tile_impacts[bullet.id as usize] = Some(ProjectileTileImpact::PassThrough);
    let enemy = world.spawn_enemy_from_template(
        62.0,
        50.0,
        DEFAULT_TEXTURE_ID,
        scene.config.enemy_template,
        scene.config.enemy_health,
        scene.config.score_reward,
    );
    let tilemap = projectile_tilemap(true, None);

    world.update(0.1);
    scene.handle_collisions(
        &mut world,
        &tilemap,
        &mut audio_events,
        0.1,
        None,
        None,
        None,
        None,
    );

    assert!(!world.alive[bullet.id as usize]);
    assert!(world.alive[enemy.id as usize]);
    assert_eq!(world.healths[enemy.id as usize], Some(2.0));
    assert_eq!(scene.score(), 0);
}

#[test]
fn pass_through_projectile_skips_tile_side_effect_reactions() {
    let (mut scene, mut world, _, mut audio_events) = playing_scene();
    let bullet = world.spawn_bullet(60.0, 50.0, 0.0, 0.0, DEFAULT_TEXTURE_ID);
    world.projectile_tile_impacts[bullet.id as usize] = Some(ProjectileTileImpact::PassThrough);
    assert!(world.add_collision_reaction(
        bullet,
        CollisionReaction::PlaySound {
            sound_id: 42,
            volume: 0.5,
            pitch: 1.25,
            cooldown: Cooldown::ready(0.0),
            replace_default: false,
            trigger: CollisionReactionTrigger::Contact,
        },
    ));
    assert!(world.add_collision_reaction(
        bullet,
        CollisionReaction::Despawn {
            target: CollisionTarget::SelfEntity,
        },
    ));
    let tilemap = projectile_tilemap(true, None);
    let mut gameplay_events = Vec::new();

    {
        let mut gameplay_sink = GameplayEventSink::new(&mut gameplay_events);
        scene.handle_collisions(
            &mut world,
            &tilemap,
            &mut audio_events,
            0.0,
            None,
            Some(&mut gameplay_sink),
            None,
            None,
        );
    }

    assert!(world.alive[bullet.id as usize]);
    assert!(audio_events.is_empty());
    assert!(gameplay_events.is_empty());
}

#[test]
fn bounce_projectile_reflects_velocity_and_survives_blocking_tile() {
    let (mut scene, mut world, _, mut audio_events) = playing_scene();
    let bullet = world.spawn_bullet(40.0, 50.0, 200.0, 0.0, DEFAULT_TEXTURE_ID);
    world.projectile_tile_impacts[bullet.id as usize] = Some(ProjectileTileImpact::Bounce);
    let tilemap = projectile_tilemap(true, None);
    let mut gameplay_events = Vec::new();

    world.update(0.1);
    {
        let mut gameplay_sink = GameplayEventSink::new(&mut gameplay_events);
        scene.handle_collisions(
            &mut world,
            &tilemap,
            &mut audio_events,
            0.1,
            None,
            Some(&mut gameplay_sink),
            None,
            None,
        );
    }

    assert!(world.alive[bullet.id as usize]);
    let velocity = world.velocities[bullet.id as usize].unwrap();
    assert!(velocity.vx < 0.0);
    assert!(velocity.vy.abs() < 0.01);
    let transform = world.transforms[bullet.id as usize].unwrap();
    assert!(transform.x < 44.0);
    assert_eq!(gameplay_events.len(), 1);
    assert_eq!(gameplay_events[0].kind, GAMEPLAY_EVENT_TILE_IMPACT);
    assert_eq!(gameplay_events[0].actor_id, bullet.id);
    assert_eq!(gameplay_events[0].source_id, bullet.id);
    assert_eq!(
        gameplay_events[0].token_id,
        ProjectileTileImpact::Bounce.code()
    );
    assert_eq!(
        gameplay_events[0].flags,
        GAMEPLAY_EVENT_FLAG_TILE_IMPACT_BOUNCED
            | (GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_POSITIVE_X
                << GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_SHIFT)
    );
    assert_eq!(gameplay_events[0].payload_bits, 0);
}

#[test]
fn despawn_projectile_emits_terminal_tile_impact_event() {
    let (mut scene, mut world, _, mut audio_events) = playing_scene();
    let bullet = world.spawn_bullet(40.0, 50.0, 200.0, 0.0, DEFAULT_TEXTURE_ID);
    world.projectile_tile_impacts[bullet.id as usize] = Some(ProjectileTileImpact::Despawn);
    let tilemap = projectile_tilemap(true, None);
    let mut gameplay_events = Vec::new();

    world.update(0.1);
    {
        let mut gameplay_sink = GameplayEventSink::new(&mut gameplay_events);
        scene.handle_collisions(
            &mut world,
            &tilemap,
            &mut audio_events,
            0.1,
            None,
            Some(&mut gameplay_sink),
            None,
            None,
        );
    }

    assert!(!world.alive[bullet.id as usize]);
    assert_eq!(gameplay_events.len(), 1);
    assert_eq!(gameplay_events[0].kind, GAMEPLAY_EVENT_TILE_IMPACT);
    assert_eq!(gameplay_events[0].actor_id, bullet.id);
    assert_eq!(gameplay_events[0].source_id, bullet.id);
    assert_eq!(
        gameplay_events[0].token_id,
        ProjectileTileImpact::Despawn.code()
    );
    assert_eq!(
        gameplay_events[0].flags,
        GAMEPLAY_EVENT_FLAG_TARGET_REMOVED
            | (GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_POSITIVE_X
                << GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_SHIFT)
    );
    assert_eq!(gameplay_events[0].payload_bits, 0);
}

#[test]
fn bounce_projectile_does_not_hit_enemy_behind_blocking_tile_in_same_frame() {
    let (mut scene, mut world, mut camera, mut audio_events) = playing_scene();
    scene.set_combat(&mut world, &mut camera, &mut audio_events, 3.0, 1.0, 5);
    let bullet = world.spawn_bullet(40.0, 50.0, 200.0, 0.0, DEFAULT_TEXTURE_ID);
    world.projectile_tile_impacts[bullet.id as usize] = Some(ProjectileTileImpact::Bounce);
    let enemy = world.spawn_enemy_from_template(
        62.0,
        50.0,
        DEFAULT_TEXTURE_ID,
        scene.config.enemy_template,
        scene.config.enemy_health,
        scene.config.score_reward,
    );
    let tilemap = projectile_tilemap(true, None);

    world.update(0.1);
    scene.handle_collisions(
        &mut world,
        &tilemap,
        &mut audio_events,
        0.1,
        None,
        None,
        None,
        None,
    );

    assert!(world.alive[bullet.id as usize]);
    assert!(world.alive[enemy.id as usize]);
    assert_eq!(world.healths[enemy.id as usize], Some(3.0));
    assert_eq!(scene.score(), 0);
}

#[test]
fn bounce_projectile_does_not_hit_player_behind_blocking_tile_in_same_frame() {
    let (mut scene, mut world, _, mut audio_events) = playing_scene();
    let player = world.player.unwrap();
    world.transforms[player.id as usize] = Some(Transform2D { x: 62.0, y: 50.0 });
    let bullet = world.spawn_bullet(40.0, 50.0, 200.0, 0.0, DEFAULT_TEXTURE_ID);
    world.projectile_collision_targets[bullet.id as usize] =
        Some(ProjectileCollisionTarget::Player);
    world.projectile_tile_impacts[bullet.id as usize] = Some(ProjectileTileImpact::Bounce);
    let tilemap = projectile_tilemap(true, None);

    world.update(0.1);
    scene.handle_collisions(
        &mut world,
        &tilemap,
        &mut audio_events,
        0.1,
        None,
        None,
        None,
        None,
    );

    assert!(world.alive[bullet.id as usize]);
    assert_eq!(scene.game_state(), GameState::Playing);
}

#[test]
fn bounce_projectile_keeps_tile_side_effect_reactions_additive() {
    let (mut scene, mut world, _, mut audio_events) = playing_scene();
    let bullet = world.spawn_bullet(40.0, 50.0, 200.0, 0.0, DEFAULT_TEXTURE_ID);
    world.projectile_tile_impacts[bullet.id as usize] = Some(ProjectileTileImpact::Bounce);
    assert!(world.add_collision_reaction(
        bullet,
        CollisionReaction::PlaySound {
            sound_id: 42,
            volume: 0.5,
            pitch: 1.25,
            cooldown: Cooldown::ready(0.0),
            replace_default: false,
            trigger: CollisionReactionTrigger::Contact,
        },
    ));
    let tilemap = projectile_tilemap(true, None);

    world.update(0.1);
    scene.handle_collisions(
        &mut world,
        &tilemap,
        &mut audio_events,
        0.1,
        None,
        None,
        None,
        None,
    );

    assert!(world.alive[bullet.id as usize]);
    assert_eq!(audio_events.len(), 1);
    assert_eq!(audio_events[0].sound_id, 42.0);
}

#[test]
fn bullet_ignores_tiles_that_do_not_block_projectiles() {
    let (mut scene, mut world, _, mut audio_events) = playing_scene();
    let bullet = world.spawn_bullet(40.0, 50.0, 200.0, 0.0, DEFAULT_TEXTURE_ID);
    let tilemap = projectile_tilemap(false, None);

    world.update(0.1);
    scene.handle_collisions(
        &mut world,
        &tilemap,
        &mut audio_events,
        0.1,
        None,
        None,
        None,
        None,
    );

    assert!(world.alive[bullet.id as usize]);
}

#[test]
fn bullet_tile_collision_requires_overlapping_height_span_when_authored() {
    let (mut scene, mut world, _, mut audio_events) = playing_scene();
    let bullet = world.spawn_bullet(60.0, 50.0, 0.0, 0.0, DEFAULT_TEXTURE_ID);
    assert!(world.set_height_span(
        bullet,
        HeightSpan::new(PhysicsFloorId(2), 0.0, 4.0).unwrap(),
    ));
    let mut tilemap = projectile_tilemap(true, HeightSpan::new(PhysicsFloorId(1), 0.0, 8.0));

    scene.handle_collisions(
        &mut world,
        &tilemap,
        &mut audio_events,
        0.0,
        None,
        None,
        None,
        None,
    );
    assert!(world.alive[bullet.id as usize]);

    assert!(tilemap.set_tile_height_span_definition(1, 2, 0.0, 8.0));
    scene.handle_collisions(
        &mut world,
        &tilemap,
        &mut audio_events,
        0.0,
        None,
        None,
        None,
        None,
    );
    assert!(!world.alive[bullet.id as usize]);
}

#[test]
fn authored_bullet_tile_collision_reactions_can_despawn_and_emit_side_effects() {
    let (mut scene, mut world, _, mut audio_events) = playing_scene();
    let bullet = world.spawn_bullet(60.0, 50.0, 0.0, 0.0, DEFAULT_TEXTURE_ID);
    assert!(world.add_collision_reaction(
        bullet,
        CollisionReaction::PlaySound {
            sound_id: 42,
            volume: 0.5,
            pitch: 1.25,
            cooldown: Cooldown::ready(0.0),
            replace_default: false,
            trigger: CollisionReactionTrigger::Contact,
        },
    ));
    assert!(world.add_collision_reaction(
        bullet,
        CollisionReaction::SpawnParticle {
            preset_id: 0,
            target: CollisionTarget::SelfEntity,
            cooldown: Cooldown::ready(0.0),
            replace_default: false,
            trigger: CollisionReactionTrigger::Contact,
        },
    ));
    assert!(world.add_collision_reaction(
        bullet,
        CollisionReaction::Despawn {
            target: CollisionTarget::SelfEntity,
        },
    ));
    let tilemap = projectile_tilemap(true, None);
    let mut gameplay_events = Vec::new();
    let mut preset = ParticlePreset::new(DEFAULT_TEXTURE_ID);
    preset.burst_count = 2;
    let particle_presets = [Some(preset)];
    let mut particles = ParticleSystem::with_capacity(8);

    {
        let mut gameplay_sink = GameplayEventSink::new(&mut gameplay_events);
        let mut particle_sink =
            ParticleBurstSink::with_presets(&mut particles, None, &particle_presets);
        scene.handle_collisions(
            &mut world,
            &tilemap,
            &mut audio_events,
            0.0,
            None,
            Some(&mut gameplay_sink),
            Some(&mut particle_sink),
            None,
        );
    }

    assert!(!world.alive[bullet.id as usize]);
    assert_eq!(audio_events.len(), 1);
    assert_eq!(audio_events[0].sound_id, 42.0);
    assert_eq!(audio_events[0].volume, 0.5);
    assert_eq!(audio_events[0].pitch, 1.25);
    assert_eq!(particles.particle_count(), 2);
    assert_eq!(gameplay_events.len(), 2);
    assert_eq!(gameplay_events[0].kind, GAMEPLAY_EVENT_COLLISION_DESPAWN);
    assert_eq!(gameplay_events[0].actor_id, bullet.id);
    assert_eq!(gameplay_events[0].source_id, bullet.id);
    assert_eq!(gameplay_events[1].kind, GAMEPLAY_EVENT_TILE_IMPACT);
    assert_eq!(gameplay_events[1].actor_id, bullet.id);
    assert_eq!(gameplay_events[1].source_id, bullet.id);
    assert_eq!(
        gameplay_events[1].token_id,
        ProjectileTileImpact::Despawn.code()
    );
    assert_eq!(
        gameplay_events[1].flags & GAMEPLAY_EVENT_FLAG_TARGET_REMOVED,
        GAMEPLAY_EVENT_FLAG_TARGET_REMOVED
    );
}

#[test]
fn authored_bullet_tile_collision_side_effects_keep_legacy_despawn() {
    let (mut scene, mut world, _, mut audio_events) = playing_scene();
    let bullet = world.spawn_bullet(60.0, 50.0, 0.0, 0.0, DEFAULT_TEXTURE_ID);
    assert!(world.add_collision_reaction(
        bullet,
        CollisionReaction::PlaySound {
            sound_id: 42,
            volume: 0.5,
            pitch: 1.25,
            cooldown: Cooldown::ready(0.0),
            replace_default: false,
            trigger: CollisionReactionTrigger::Contact,
        },
    ));
    let tilemap = projectile_tilemap(true, None);

    scene.handle_collisions(
        &mut world,
        &tilemap,
        &mut audio_events,
        0.0,
        None,
        None,
        None,
        None,
    );

    assert!(!world.alive[bullet.id as usize]);
    assert_eq!(audio_events.len(), 1);
    assert_eq!(audio_events[0].sound_id, 42.0);
}

#[test]
fn authored_bullet_tile_collision_ignores_entity_only_other_targets() {
    let (mut scene, mut world, _, mut audio_events) = playing_scene();
    let bullet = world.spawn_bullet(60.0, 50.0, 0.0, 0.0, DEFAULT_TEXTURE_ID);
    assert!(world.add_collision_reaction(
        bullet,
        CollisionReaction::Despawn {
            target: CollisionTarget::OtherEntity,
        },
    ));
    assert!(world.add_collision_reaction(
        bullet,
        CollisionReaction::SpawnParticle {
            preset_id: 0,
            target: CollisionTarget::OtherEntity,
            cooldown: Cooldown::ready(0.0),
            replace_default: false,
            trigger: CollisionReactionTrigger::Contact,
        },
    ));
    let tilemap = projectile_tilemap(true, None);
    let mut gameplay_events = Vec::new();
    let particle_presets = [Some(ParticlePreset::new(DEFAULT_TEXTURE_ID))];
    let mut particles = ParticleSystem::with_capacity(8);

    {
        let mut gameplay_sink = GameplayEventSink::new(&mut gameplay_events);
        let mut particle_sink =
            ParticleBurstSink::with_presets(&mut particles, None, &particle_presets);
        scene.handle_collisions(
            &mut world,
            &tilemap,
            &mut audio_events,
            0.0,
            None,
            Some(&mut gameplay_sink),
            Some(&mut particle_sink),
            None,
        );
    }

    assert!(!world.alive[bullet.id as usize]);
    assert!(audio_events.is_empty());
    assert_eq!(particles.particle_count(), 0);
    assert_eq!(gameplay_events.len(), 1);
    assert_eq!(gameplay_events[0].kind, GAMEPLAY_EVENT_TILE_IMPACT);
    assert_eq!(gameplay_events[0].actor_id, bullet.id);
    assert_eq!(gameplay_events[0].source_id, bullet.id);
    assert_eq!(
        gameplay_events[0].token_id,
        ProjectileTileImpact::Despawn.code()
    );
    assert_eq!(
        gameplay_events[0].flags & GAMEPLAY_EVENT_FLAG_TARGET_REMOVED,
        GAMEPLAY_EVENT_FLAG_TARGET_REMOVED
    );
}

#[test]
fn bullet_damage_reduces_enemy_health_before_death() {
    let (mut scene, mut world, mut camera, mut audio_events) = playing_scene();
    scene.set_combat(&mut world, &mut camera, &mut audio_events, 3.0, 1.0, 5);
    let b = world.spawn_bullet(50.0, 50.0, 0.0, 0.0, DEFAULT_TEXTURE_ID);
    let e = world.spawn_enemy_from_template(
        52.0,
        50.0,
        DEFAULT_TEXTURE_ID,
        scene.config.enemy_template,
        scene.config.enemy_health,
        scene.config.score_reward,
    );

    scene.handle_collisions(
        &mut world,
        &Tilemap::default(),
        &mut audio_events,
        0.0,
        None,
        None,
        None,
        None,
    );

    assert!(!world.alive[b.id as usize]);
    assert!(world.alive[e.id as usize]);
    assert_eq!(world.healths[e.id as usize], Some(2.0));
    assert_eq!(scene.score(), 0);
}

#[test]
fn nonlethal_bullet_enemy_hit_flashes_enemy_hit_tween() {
    let (mut scene, mut world, mut camera, mut audio_events) = playing_scene();
    scene.set_combat(&mut world, &mut camera, &mut audio_events, 3.0, 1.0, 5);
    let mut tweens = TweenSystem::new();
    let bullet = world.spawn_bullet(50.0, 50.0, 0.0, 0.0, DEFAULT_TEXTURE_ID);
    let enemy = world.spawn_enemy_from_template(
        52.0,
        50.0,
        DEFAULT_TEXTURE_ID,
        scene.config.enemy_template,
        scene.config.enemy_health,
        scene.config.score_reward,
    );

    {
        let mut tween_sink = TweenSink::new(&mut tweens);
        scene.handle_collisions(
            &mut world,
            &Tilemap::default(),
            &mut audio_events,
            0.0,
            None,
            None,
            None,
            Some(&mut tween_sink),
        );
    }

    assert!(!world.alive[bullet.id as usize]);
    assert!(world.alive[enemy.id as usize]);
    assert_eq!(world.healths[enemy.id as usize], Some(2.0));
    assert_eq!(tweens.tween_count(), 1);
}

#[test]
fn authored_collision_reactions_damage_enemy_and_despawn_bullet() {
    let (mut scene, mut world, _, mut audio_events) = playing_scene();
    let mut gameplay_events = Vec::new();
    let bullet = world.spawn_bullet(50.0, 50.0, 0.0, 0.0, DEFAULT_TEXTURE_ID);
    let enemy = world.spawn_enemy(52.0, 50.0, DEFAULT_TEXTURE_ID);
    assert!(world.add_collision_reaction(
        bullet,
        CollisionReaction::Damage {
            target: CollisionTarget::OtherEntity,
        },
    ));
    assert!(world.add_collision_reaction(
        bullet,
        CollisionReaction::Despawn {
            target: CollisionTarget::SelfEntity,
        },
    ));

    {
        let mut gameplay_sink = GameplayEventSink::new(&mut gameplay_events);
        scene.handle_collisions(
            &mut world,
            &Tilemap::default(),
            &mut audio_events,
            0.0,
            None,
            Some(&mut gameplay_sink),
            None,
            None,
        );
    }

    assert!(!world.alive[bullet.id as usize]);
    assert!(!world.alive[enemy.id as usize]);
    assert_eq!(scene.score(), 1);
    assert_eq!(gameplay_events.len(), 2);
    assert_eq!(gameplay_events[0].kind, GAMEPLAY_EVENT_COLLISION_DAMAGE);
    assert_eq!(gameplay_events[0].actor_id, enemy.id);
    assert_eq!(gameplay_events[0].source_id, bullet.id);
    assert_eq!(gameplay_events[0].payload_bits, 1.0_f32.to_bits());
    assert_eq!(
        gameplay_events[0].flags & GAMEPLAY_EVENT_FLAG_TARGET_REMOVED,
        GAMEPLAY_EVENT_FLAG_TARGET_REMOVED,
    );
    assert_eq!(gameplay_events[1].kind, GAMEPLAY_EVENT_COLLISION_DESPAWN);
    assert_eq!(gameplay_events[1].actor_id, bullet.id);
    assert_eq!(gameplay_events[1].source_id, bullet.id);
}

#[test]
fn authored_bullet_damage_faction_denial_skips_default_hit_presentation() {
    let (mut scene, mut world, _, mut audio_events) = playing_scene();
    let mut gameplay_events = Vec::new();
    let mut collision_events = Vec::new();
    let mut collision_event_counts = crate::collision_event::CollisionEventCounts::default();
    let mut hit_preset = ParticlePreset::new(DEFAULT_TEXTURE_ID);
    hit_preset.burst_count = 2;
    let mut particles = ParticleSystem::with_capacity(8);
    let bullet = world.spawn_bullet(50.0, 50.0, 0.0, 0.0, DEFAULT_TEXTURE_ID);
    let enemy = world.spawn_enemy(52.0, 50.0, DEFAULT_TEXTURE_ID);
    let original_enemy_health = world.healths[enemy.id as usize];
    world.set_gameplay_faction(
        bullet,
        GameplayFaction::new(GAMEPLAY_FACTION_PLAYER, 0).unwrap(),
    );
    world.set_gameplay_faction(
        enemy,
        GameplayFaction::new(GAMEPLAY_FACTION_ENEMY, 1 << GAMEPLAY_FACTION_PLAYER).unwrap(),
    );
    assert!(world.add_collision_reaction(
        bullet,
        CollisionReaction::Damage {
            target: CollisionTarget::OtherEntity,
        },
    ));

    {
        let mut collision_sink =
            CollisionEventSink::new(&mut collision_events, &mut collision_event_counts);
        let mut gameplay_sink = GameplayEventSink::new(&mut gameplay_events);
        let mut particle_sink =
            ParticleBurstSink::with_presets(&mut particles, Some(hit_preset), &[]);
        scene.handle_collisions(
            &mut world,
            &Tilemap::default(),
            &mut audio_events,
            0.0,
            Some(&mut collision_sink),
            Some(&mut gameplay_sink),
            Some(&mut particle_sink),
            None,
        );
    }

    assert!(world.alive[bullet.id as usize]);
    assert!(world.alive[enemy.id as usize]);
    assert_eq!(world.healths[enemy.id as usize], original_enemy_health);
    assert_eq!(scene.score(), 0);
    assert!(collision_events.is_empty());
    assert_eq!(collision_event_counts.hit, 0);
    assert!(audio_events.is_empty());
    assert_eq!(particles.particle_count(), 0);
    assert_eq!(gameplay_events.len(), 1);
    assert_eq!(
        gameplay_events[0].kind,
        GAMEPLAY_EVENT_FACTION_DAMAGE_DENIED
    );
    assert_eq!(gameplay_events[0].actor_id, enemy.id);
    assert_eq!(gameplay_events[0].source_id, bullet.id);
    assert_eq!(gameplay_events[0].token_id, GAMEPLAY_FACTION_PLAYER);
    assert_eq!(gameplay_events[0].payload_bits, GAMEPLAY_FACTION_ENEMY);
}

#[test]
fn authored_collision_reaction_overrides_default_damage_when_damage_missing() {
    let (mut scene, mut world, _, mut audio_events) = playing_scene();
    let bullet = world.spawn_bullet(50.0, 50.0, 0.0, 0.0, DEFAULT_TEXTURE_ID);
    let enemy = world.spawn_enemy(52.0, 50.0, DEFAULT_TEXTURE_ID);
    assert!(world.add_collision_reaction(
        bullet,
        CollisionReaction::Despawn {
            target: CollisionTarget::SelfEntity,
        },
    ));

    scene.handle_collisions(
        &mut world,
        &Tilemap::default(),
        &mut audio_events,
        0.0,
        None,
        None,
        None,
        None,
    );

    assert!(!world.alive[bullet.id as usize]);
    assert!(world.alive[enemy.id as usize]);
    assert_eq!(world.healths[enemy.id as usize], Some(1.0));
    assert_eq!(scene.score(), 0);
}

#[test]
fn authored_collision_reaction_uses_source_damage_component() {
    let (mut scene, mut world, mut camera, mut audio_events) = playing_scene();
    scene.set_combat(&mut world, &mut camera, &mut audio_events, 3.0, 2.0, 5);
    let bullet = world.spawn_bullet_from_template(
        Transform2D { x: 50.0, y: 50.0 },
        Velocity::default(),
        DEFAULT_TEXTURE_ID,
        DEFAULT_BULLET_LIFETIME,
        scene.config.bullet_template,
        scene.config.bullet_damage,
    );
    let enemy = world.spawn_enemy_from_template(
        52.0,
        50.0,
        DEFAULT_TEXTURE_ID,
        scene.config.enemy_template,
        scene.config.enemy_health,
        scene.config.score_reward,
    );
    assert!(world.add_collision_reaction(
        bullet,
        CollisionReaction::Damage {
            target: CollisionTarget::OtherEntity,
        },
    ));
    assert!(world.add_collision_reaction(
        bullet,
        CollisionReaction::Despawn {
            target: CollisionTarget::SelfEntity,
        },
    ));

    scene.handle_collisions(
        &mut world,
        &Tilemap::default(),
        &mut audio_events,
        0.0,
        None,
        None,
        None,
        None,
    );

    assert!(!world.alive[bullet.id as usize]);
    assert!(world.alive[enemy.id as usize]);
    assert_eq!(world.healths[enemy.id as usize], Some(1.0));
    assert_eq!(scene.score(), 0);
}

#[test]
fn authored_collision_reaction_despawn_other_without_score() {
    let (mut scene, mut world, _, mut audio_events) = playing_scene();
    let bullet = world.spawn_bullet(50.0, 50.0, 0.0, 0.0, DEFAULT_TEXTURE_ID);
    let enemy = world.spawn_enemy(52.0, 50.0, DEFAULT_TEXTURE_ID);
    assert!(world.add_collision_reaction(
        bullet,
        CollisionReaction::Despawn {
            target: CollisionTarget::OtherEntity,
        },
    ));

    scene.handle_collisions(
        &mut world,
        &Tilemap::default(),
        &mut audio_events,
        0.0,
        None,
        None,
        None,
        None,
    );

    assert!(world.alive[bullet.id as usize]);
    assert!(!world.alive[enemy.id as usize]);
    assert_eq!(scene.score(), 0);
}

#[test]
fn authored_player_enemy_collision_damage_player_sets_game_over_without_despawn() {
    let (mut scene, mut world, _, mut audio_events) = playing_scene();
    scene.set_sound_ids(10, 20, 30);
    let mut gameplay_events = Vec::new();
    let player = world.player.unwrap();
    let player_transform = world.transforms[player.id as usize].unwrap();
    let enemy = world.spawn_enemy(player_transform.x, player_transform.y, DEFAULT_TEXTURE_ID);
    world.damages[enemy.id as usize] = Some(1.0);
    assert!(world.add_collision_reaction(
        enemy,
        CollisionReaction::Damage {
            target: CollisionTarget::OtherEntity,
        },
    ));

    {
        let mut gameplay_sink = GameplayEventSink::new(&mut gameplay_events);
        scene.handle_collisions(
            &mut world,
            &Tilemap::default(),
            &mut audio_events,
            0.0,
            None,
            Some(&mut gameplay_sink),
            None,
            None,
        );
    }

    assert_eq!(scene.game_state(), GameState::GameOver);
    assert!(world.alive[player.id as usize]);
    assert_eq!(world.player, Some(player));
    assert!(world.alive[enemy.id as usize]);
    assert_eq!(scene.score(), 0);
    assert_eq!(gameplay_events.len(), 1);
    assert_eq!(gameplay_events[0].kind, GAMEPLAY_EVENT_COLLISION_DAMAGE);
    assert_eq!(gameplay_events[0].actor_id, player.id);
    assert_eq!(gameplay_events[0].source_id, enemy.id);
    assert_eq!(gameplay_events[0].payload_bits, 1.0_f32.to_bits());
    assert_eq!(
        gameplay_events[0].flags & GAMEPLAY_EVENT_FLAG_TARGET_REMOVED,
        0,
    );
    assert_eq!(audio_events.len(), 1);
}

#[test]
fn authored_player_enemy_collision_nonlethal_damage_overrides_hardcoded_game_over() {
    let (mut scene, mut world, _, mut audio_events) = playing_scene();
    let player = world.player.unwrap();
    let player_transform = world.transforms[player.id as usize].unwrap();
    let enemy = world.spawn_enemy(player_transform.x, player_transform.y, DEFAULT_TEXTURE_ID);
    world.healths[player.id as usize] = Some(3.0);
    world.damages[enemy.id as usize] = Some(1.0);
    assert!(world.add_collision_reaction(
        enemy,
        CollisionReaction::Damage {
            target: CollisionTarget::OtherEntity,
        },
    ));

    scene.handle_collisions(
        &mut world,
        &Tilemap::default(),
        &mut audio_events,
        0.0,
        None,
        None,
        None,
        None,
    );

    assert_eq!(scene.game_state(), GameState::Playing);
    assert!(world.alive[player.id as usize]);
    assert_eq!(world.healths[player.id as usize], Some(2.0));
    assert!(audio_events.is_empty());
}

#[test]
fn authored_collision_damage_respects_gameplay_faction_damage_mask() {
    let (mut scene, mut world, _, mut audio_events) = playing_scene();
    let mut gameplay_events = Vec::new();
    let player = world.player.unwrap();
    let player_transform = world.transforms[player.id as usize].unwrap();
    let enemy = world.spawn_enemy(player_transform.x, player_transform.y, DEFAULT_TEXTURE_ID);
    world.healths[player.id as usize] = Some(3.0);
    world.damages[enemy.id as usize] = Some(1.0);
    world.set_gameplay_faction(
        player,
        GameplayFaction::new(GAMEPLAY_FACTION_PLAYER, 1 << GAMEPLAY_FACTION_ENEMY).unwrap(),
    );
    world.set_gameplay_faction(
        enemy,
        GameplayFaction::new(GAMEPLAY_FACTION_ENEMY, 0).unwrap(),
    );
    assert!(world.add_collision_reaction(
        enemy,
        CollisionReaction::Damage {
            target: CollisionTarget::OtherEntity,
        },
    ));

    {
        let mut gameplay_sink = GameplayEventSink::new(&mut gameplay_events);
        scene.handle_collisions(
            &mut world,
            &Tilemap::default(),
            &mut audio_events,
            0.0,
            None,
            Some(&mut gameplay_sink),
            None,
            None,
        );
    }

    assert_eq!(scene.game_state(), GameState::Playing);
    assert_eq!(world.healths[player.id as usize], Some(3.0));
    assert!(world.alive[player.id as usize]);
    assert!(world.alive[enemy.id as usize]);
    assert!(audio_events.is_empty());
    assert_eq!(gameplay_events.len(), 1);
    assert_eq!(
        gameplay_events[0].kind,
        GAMEPLAY_EVENT_FACTION_DAMAGE_DENIED
    );
    assert_eq!(gameplay_events[0].actor_id, player.id);
    assert_eq!(gameplay_events[0].source_id, enemy.id);
    assert_eq!(gameplay_events[0].token_id, GAMEPLAY_FACTION_ENEMY);
    assert_eq!(gameplay_events[0].payload_bits, GAMEPLAY_FACTION_PLAYER);
}

#[test]
fn authored_player_enemy_collision_replace_default_audio_suppresses_game_over_sound() {
    let (mut scene, mut world, _, mut audio_events) = playing_scene();
    scene.set_sound_ids(10, 20, 30);
    let player = world.player.unwrap();
    let player_transform = world.transforms[player.id as usize].unwrap();
    let enemy = world.spawn_enemy(player_transform.x, player_transform.y, DEFAULT_TEXTURE_ID);
    world.damages[enemy.id as usize] = Some(1.0);
    assert!(world.add_collision_reaction(
        enemy,
        CollisionReaction::Damage {
            target: CollisionTarget::OtherEntity,
        },
    ));
    assert!(world.add_collision_reaction(
        enemy,
        CollisionReaction::PlaySound {
            sound_id: 42,
            volume: 0.5,
            pitch: 1.25,
            cooldown: Cooldown::ready(0.0),
            replace_default: true,
            trigger: CollisionReactionTrigger::Contact,
        },
    ));

    scene.handle_collisions(
        &mut world,
        &Tilemap::default(),
        &mut audio_events,
        0.0,
        None,
        None,
        None,
        None,
    );

    assert_eq!(scene.game_state(), GameState::GameOver);
    assert_eq!(audio_events.len(), 1);
    assert_eq!(audio_events[0].sound_id, 42.0);
}

#[test]
fn authored_player_enemy_collision_sound_only_replace_default_suppresses_fallback_game_over_sound()
{
    let (mut scene, mut world, _, mut audio_events) = playing_scene();
    scene.set_sound_ids(10, 20, 30);
    let player = world.player.unwrap();
    let player_transform = world.transforms[player.id as usize].unwrap();
    let enemy = world.spawn_enemy(player_transform.x, player_transform.y, DEFAULT_TEXTURE_ID);
    assert!(world.add_collision_reaction(
        enemy,
        CollisionReaction::PlaySound {
            sound_id: 42,
            volume: 0.5,
            pitch: 1.25,
            cooldown: Cooldown::ready(0.0),
            replace_default: true,
            trigger: CollisionReactionTrigger::Contact,
        },
    ));

    scene.handle_collisions(
        &mut world,
        &Tilemap::default(),
        &mut audio_events,
        0.0,
        None,
        None,
        None,
        None,
    );

    assert_eq!(scene.game_state(), GameState::GameOver);
    assert_eq!(audio_events.len(), 1);
    assert_eq!(audio_events[0].sound_id, 42.0);
}

#[test]
fn authored_player_enemy_collision_emits_default_game_over_sound_once() {
    let (mut scene, mut world, _, mut audio_events) = playing_scene();
    scene.set_sound_ids(10, 20, 30);
    let player = world.player.unwrap();
    world.healths[player.id as usize] = Some(1.0);
    let player_transform = world.transforms[player.id as usize].unwrap();
    let enemy = world.spawn_enemy(player_transform.x, player_transform.y, DEFAULT_TEXTURE_ID);
    world.damages[enemy.id as usize] = Some(1.0);
    assert!(world.add_collision_reaction(
        enemy,
        CollisionReaction::Damage {
            target: CollisionTarget::OtherEntity,
        },
    ));

    scene.handle_collisions(
        &mut world,
        &Tilemap::default(),
        &mut audio_events,
        0.0,
        None,
        None,
        None,
        None,
    );
    scene.handle_collisions(
        &mut world,
        &Tilemap::default(),
        &mut audio_events,
        0.0,
        None,
        None,
        None,
        None,
    );

    assert_eq!(scene.game_state(), GameState::GameOver);
    assert_eq!(audio_events.len(), 1);
    assert_eq!(audio_events[0].sound_id, 30.0);
}

#[test]
fn authored_bullet_enemy_collision_sound_only_keeps_default_damage_and_despawn() {
    let (mut scene, mut world, _, mut audio_events) = playing_scene();
    scene.set_sound_ids(10, 20, 30);
    let bullet = world.spawn_bullet(50.0, 50.0, 0.0, 0.0, DEFAULT_TEXTURE_ID);
    let enemy = world.spawn_enemy(52.0, 50.0, DEFAULT_TEXTURE_ID);
    assert!(world.add_collision_reaction(
        bullet,
        CollisionReaction::PlaySound {
            sound_id: 42,
            volume: 0.5,
            pitch: 1.25,
            cooldown: Cooldown::ready(0.0),
            replace_default: false,
            trigger: CollisionReactionTrigger::Contact,
        },
    ));

    scene.handle_collisions(
        &mut world,
        &Tilemap::default(),
        &mut audio_events,
        0.0,
        None,
        None,
        None,
        None,
    );

    assert!(!world.alive[bullet.id as usize]);
    assert!(!world.alive[enemy.id as usize]);
    assert_eq!(scene.score(), 1);
    assert_eq!(audio_events.len(), 2);
    assert!(audio_events.iter().any(|event| event.sound_id == 42.0));
}

#[test]
fn authored_bullet_enemy_collision_sound_can_replace_default_hit_audio() {
    let (mut scene, mut world, _, mut audio_events) = playing_scene();
    scene.set_sound_ids(10, 20, 30);
    let bullet = world.spawn_bullet(50.0, 50.0, 0.0, 0.0, DEFAULT_TEXTURE_ID);
    let enemy = world.spawn_enemy(52.0, 50.0, DEFAULT_TEXTURE_ID);
    assert!(world.add_collision_reaction(
        bullet,
        CollisionReaction::PlaySound {
            sound_id: 42,
            volume: 0.5,
            pitch: 1.25,
            cooldown: Cooldown::ready(0.0),
            replace_default: true,
            trigger: CollisionReactionTrigger::Contact,
        },
    ));

    scene.handle_collisions(
        &mut world,
        &Tilemap::default(),
        &mut audio_events,
        0.0,
        None,
        None,
        None,
        None,
    );

    assert!(!world.alive[bullet.id as usize]);
    assert!(!world.alive[enemy.id as usize]);
    assert_eq!(scene.score(), 1);
    assert_eq!(audio_events.len(), 1);
    assert_eq!(audio_events[0].sound_id, 42.0);
}

#[test]
fn authored_bullet_enemy_replace_default_audio_still_records_hit_event() {
    let (mut scene, mut world, _, mut audio_events) = playing_scene();
    scene.set_sound_ids(10, 20, 30);
    let bullet = world.spawn_bullet(50.0, 50.0, 0.0, 0.0, DEFAULT_TEXTURE_ID);
    let enemy = world.spawn_enemy(52.0, 50.0, DEFAULT_TEXTURE_ID);
    assert!(world.add_collision_reaction(
        bullet,
        CollisionReaction::PlaySound {
            sound_id: 42,
            volume: 0.5,
            pitch: 1.25,
            cooldown: Cooldown::ready(0.0),
            replace_default: true,
            trigger: CollisionReactionTrigger::Contact,
        },
    ));
    let mut collision_events = Vec::new();
    let mut collision_event_counts = crate::collision_event::CollisionEventCounts::default();

    {
        let mut collision_sink =
            CollisionEventSink::new(&mut collision_events, &mut collision_event_counts);
        scene.handle_collisions(
            &mut world,
            &Tilemap::default(),
            &mut audio_events,
            0.0,
            Some(&mut collision_sink),
            None,
            None,
            None,
        );
    }

    assert_eq!(collision_event_counts.hit, 1);
    assert_eq!(collision_events.len(), 1);
    assert_eq!(
        collision_events[0].kind,
        crate::collision_event::COLLISION_EVENT_HIT,
    );
    assert_eq!(collision_events[0].a_id, bullet.id);
    assert_eq!(collision_events[0].b_id, enemy.id);
    assert_eq!(audio_events.len(), 1);
    assert_eq!(audio_events[0].sound_id, 42.0);
}

#[test]
fn authored_bullet_enemy_collision_particle_only_keeps_default_damage_and_despawn() {
    let (mut scene, mut world, _, mut audio_events) = playing_scene();
    let bullet = world.spawn_bullet(50.0, 50.0, 0.0, 0.0, DEFAULT_TEXTURE_ID);
    let enemy = world.spawn_enemy(52.0, 50.0, DEFAULT_TEXTURE_ID);
    assert!(world.add_collision_reaction(
        bullet,
        CollisionReaction::SpawnParticle {
            preset_id: 1,
            target: CollisionTarget::OtherEntity,
            cooldown: Cooldown::ready(0.0),
            replace_default: false,
            trigger: CollisionReactionTrigger::Contact,
        },
    ));
    let mut authored_preset = ParticlePreset::new(DEFAULT_TEXTURE_ID);
    authored_preset.burst_count = 2;
    let mut hit_preset = ParticlePreset::new(DEFAULT_TEXTURE_ID);
    hit_preset.burst_count = 3;
    let particle_presets = [None, Some(authored_preset)];
    let mut particles = ParticleSystem::with_capacity(8);

    {
        let mut particle_sink =
            ParticleBurstSink::with_presets(&mut particles, Some(hit_preset), &particle_presets);
        scene.handle_collisions(
            &mut world,
            &Tilemap::default(),
            &mut audio_events,
            0.0,
            None,
            None,
            Some(&mut particle_sink),
            None,
        );
    }

    assert!(!world.alive[bullet.id as usize]);
    assert!(!world.alive[enemy.id as usize]);
    assert_eq!(scene.score(), 1);
    assert_eq!(particles.particle_count(), 5);
}

#[test]
fn authored_bullet_enemy_collision_particle_can_replace_default_hit_burst() {
    let (mut scene, mut world, _, mut audio_events) = playing_scene();
    let bullet = world.spawn_bullet(50.0, 50.0, 0.0, 0.0, DEFAULT_TEXTURE_ID);
    let enemy = world.spawn_enemy(52.0, 50.0, DEFAULT_TEXTURE_ID);
    assert!(world.add_collision_reaction(
        bullet,
        CollisionReaction::SpawnParticle {
            preset_id: 1,
            target: CollisionTarget::OtherEntity,
            cooldown: Cooldown::ready(0.0),
            replace_default: true,
            trigger: CollisionReactionTrigger::Contact,
        },
    ));
    let mut authored_preset = ParticlePreset::new(DEFAULT_TEXTURE_ID);
    authored_preset.burst_count = 2;
    let mut hit_preset = ParticlePreset::new(DEFAULT_TEXTURE_ID);
    hit_preset.burst_count = 3;
    let particle_presets = [None, Some(authored_preset)];
    let mut particles = ParticleSystem::with_capacity(8);

    {
        let mut particle_sink =
            ParticleBurstSink::with_presets(&mut particles, Some(hit_preset), &particle_presets);
        scene.handle_collisions(
            &mut world,
            &Tilemap::default(),
            &mut audio_events,
            0.0,
            None,
            None,
            Some(&mut particle_sink),
            None,
        );
    }

    assert!(!world.alive[bullet.id as usize]);
    assert!(!world.alive[enemy.id as usize]);
    assert_eq!(scene.score(), 1);
    assert_eq!(particles.particle_count(), 2);
}

#[test]
fn authored_collision_sound_reaction_pushes_audio_without_gameplay_callback() {
    let (mut scene, mut world, _, mut audio_events) = playing_scene();
    let player = world.player.unwrap();
    let player_transform = world.transforms[player.id as usize].unwrap();
    let enemy = world.spawn_enemy(player_transform.x, player_transform.y, DEFAULT_TEXTURE_ID);
    assert!(world.add_collision_reaction(
        enemy,
        CollisionReaction::Damage {
            target: CollisionTarget::OtherEntity,
        },
    ));
    assert!(world.add_collision_reaction(
        enemy,
        CollisionReaction::PlaySound {
            sound_id: 42,
            volume: 0.5,
            pitch: 1.25,
            cooldown: Cooldown::ready(0.0),
            replace_default: false,
            trigger: CollisionReactionTrigger::Contact,
        },
    ));

    scene.handle_collisions(
        &mut world,
        &Tilemap::default(),
        &mut audio_events,
        0.0,
        None,
        None,
        None,
        None,
    );

    assert_eq!(scene.game_state(), GameState::Playing);
    assert!(world.alive[player.id as usize]);
    assert!(world.alive[enemy.id as usize]);
    assert_eq!(audio_events.len(), 1);
    assert_eq!(audio_events[0].sound_id, 42.0);
    assert_eq!(audio_events[0].volume, 0.5);
    assert_eq!(audio_events[0].pitch, 1.25);
}

#[test]
fn authored_collision_sound_reaction_cooldown_limits_repeated_contact_audio() {
    let (mut scene, mut world, _, mut audio_events) = playing_scene();
    let player = world.player.unwrap();
    let player_transform = world.transforms[player.id as usize].unwrap();
    let enemy = world.spawn_enemy(player_transform.x, player_transform.y, DEFAULT_TEXTURE_ID);
    assert!(world.add_collision_reaction(
        enemy,
        CollisionReaction::Damage {
            target: CollisionTarget::OtherEntity,
        },
    ));
    assert!(world.add_collision_reaction(
        enemy,
        CollisionReaction::PlaySound {
            sound_id: 42,
            volume: 0.5,
            pitch: 1.25,
            cooldown: Cooldown::ready(0.25),
            replace_default: false,
            trigger: CollisionReactionTrigger::Contact,
        },
    ));

    scene.handle_collisions(
        &mut world,
        &Tilemap::default(),
        &mut audio_events,
        0.0,
        None,
        None,
        None,
        None,
    );
    scene.handle_collisions(
        &mut world,
        &Tilemap::default(),
        &mut audio_events,
        0.0,
        None,
        None,
        None,
        None,
    );
    world.tick_collision_reaction_cooldowns(0.24);
    scene.handle_collisions(
        &mut world,
        &Tilemap::default(),
        &mut audio_events,
        0.0,
        None,
        None,
        None,
        None,
    );
    world.tick_collision_reaction_cooldowns(0.02);
    scene.handle_collisions(
        &mut world,
        &Tilemap::default(),
        &mut audio_events,
        0.0,
        None,
        None,
        None,
        None,
    );

    assert_eq!(scene.game_state(), GameState::Playing);
    assert_eq!(audio_events.len(), 2);
}

#[test]
fn authored_collision_sound_enter_trigger_runs_once_per_continuous_contact() {
    let (mut scene, mut world, _, mut audio_events) = playing_scene();
    let player = world.player.unwrap();
    let player_transform = world.transforms[player.id as usize].unwrap();
    let enemy = world.spawn_enemy(player_transform.x, player_transform.y, DEFAULT_TEXTURE_ID);
    world.healths[player.id as usize] = Some(10.0);
    world.damages[enemy.id as usize] = Some(1.0);
    assert!(world.add_collision_reaction(
        enemy,
        CollisionReaction::Damage {
            target: CollisionTarget::OtherEntity,
        },
    ));
    assert!(world.add_collision_reaction(
        enemy,
        CollisionReaction::PlaySound {
            sound_id: 42,
            volume: 0.5,
            pitch: 1.25,
            cooldown: Cooldown::ready(0.0),
            replace_default: false,
            trigger: CollisionReactionTrigger::Enter,
        },
    ));

    scene.handle_collisions(
        &mut world,
        &Tilemap::default(),
        &mut audio_events,
        0.0,
        None,
        None,
        None,
        None,
    );
    scene.handle_collisions(
        &mut world,
        &Tilemap::default(),
        &mut audio_events,
        0.0,
        None,
        None,
        None,
        None,
    );

    assert_eq!(scene.game_state(), GameState::Playing);
    assert_eq!(world.healths[player.id as usize], Some(8.0));
    assert_eq!(audio_events.len(), 1);
    assert_eq!(audio_events[0].sound_id, 42.0);
}

#[test]
fn authored_collision_particle_reaction_spawns_registered_preset_burst() {
    let (mut scene, mut world, _, mut audio_events) = playing_scene();
    let player = world.player.unwrap();
    let player_transform = world.transforms[player.id as usize].unwrap();
    let enemy = world.spawn_enemy(player_transform.x, player_transform.y, DEFAULT_TEXTURE_ID);
    assert!(world.add_collision_reaction(
        enemy,
        CollisionReaction::Damage {
            target: CollisionTarget::OtherEntity,
        },
    ));
    assert!(world.add_collision_reaction(
        enemy,
        CollisionReaction::SpawnParticle {
            preset_id: 3,
            target: CollisionTarget::OtherEntity,
            cooldown: Cooldown::ready(0.0),
            replace_default: false,
            trigger: CollisionReactionTrigger::Contact,
        },
    ));
    let mut preset = ParticlePreset::new(DEFAULT_TEXTURE_ID);
    preset.burst_count = 2;
    let particle_presets = [None, None, None, Some(preset)];
    let mut particles = ParticleSystem::with_capacity(8);
    {
        let mut particle_sink =
            ParticleBurstSink::with_presets(&mut particles, None, &particle_presets);
        scene.handle_collisions(
            &mut world,
            &Tilemap::default(),
            &mut audio_events,
            0.0,
            None,
            None,
            Some(&mut particle_sink),
            None,
        );
    }

    assert_eq!(scene.game_state(), GameState::Playing);
    assert!(audio_events.is_empty());
    assert_eq!(particles.particle_count(), 2);
}

#[test]
fn authored_collision_particle_reaction_cooldown_limits_repeated_bursts() {
    let (mut scene, mut world, _, mut audio_events) = playing_scene();
    let player = world.player.unwrap();
    let player_transform = world.transforms[player.id as usize].unwrap();
    let enemy = world.spawn_enemy(player_transform.x, player_transform.y, DEFAULT_TEXTURE_ID);
    assert!(world.add_collision_reaction(
        enemy,
        CollisionReaction::Damage {
            target: CollisionTarget::OtherEntity,
        },
    ));
    assert!(world.add_collision_reaction(
        enemy,
        CollisionReaction::SpawnParticle {
            preset_id: 3,
            target: CollisionTarget::OtherEntity,
            cooldown: Cooldown::ready(0.5),
            replace_default: false,
            trigger: CollisionReactionTrigger::Contact,
        },
    ));
    let mut preset = ParticlePreset::new(DEFAULT_TEXTURE_ID);
    preset.burst_count = 2;
    let particle_presets = [None, None, None, Some(preset)];
    let mut particles = ParticleSystem::with_capacity(8);

    {
        let mut particle_sink =
            ParticleBurstSink::with_presets(&mut particles, None, &particle_presets);
        scene.handle_collisions(
            &mut world,
            &Tilemap::default(),
            &mut audio_events,
            0.0,
            None,
            None,
            Some(&mut particle_sink),
            None,
        );
    }
    {
        let mut particle_sink =
            ParticleBurstSink::with_presets(&mut particles, None, &particle_presets);
        scene.handle_collisions(
            &mut world,
            &Tilemap::default(),
            &mut audio_events,
            0.0,
            None,
            None,
            Some(&mut particle_sink),
            None,
        );
    }
    world.tick_collision_reaction_cooldowns(0.5);
    {
        let mut particle_sink =
            ParticleBurstSink::with_presets(&mut particles, None, &particle_presets);
        scene.handle_collisions(
            &mut world,
            &Tilemap::default(),
            &mut audio_events,
            0.0,
            None,
            None,
            Some(&mut particle_sink),
            None,
        );
    }

    assert!(audio_events.is_empty());
    assert_eq!(particles.particle_count(), 4);
}

#[test]
fn authored_collision_particle_enter_trigger_runs_once_per_continuous_contact() {
    let (mut scene, mut world, _, mut audio_events) = playing_scene();
    let player = world.player.unwrap();
    let player_transform = world.transforms[player.id as usize].unwrap();
    let enemy = world.spawn_enemy(player_transform.x, player_transform.y, DEFAULT_TEXTURE_ID);
    world.healths[player.id as usize] = Some(10.0);
    world.damages[enemy.id as usize] = Some(1.0);
    assert!(world.add_collision_reaction(
        enemy,
        CollisionReaction::Damage {
            target: CollisionTarget::OtherEntity,
        },
    ));
    assert!(world.add_collision_reaction(
        enemy,
        CollisionReaction::SpawnParticle {
            preset_id: 3,
            target: CollisionTarget::OtherEntity,
            cooldown: Cooldown::ready(0.0),
            replace_default: false,
            trigger: CollisionReactionTrigger::Enter,
        },
    ));
    let mut preset = ParticlePreset::new(DEFAULT_TEXTURE_ID);
    preset.burst_count = 2;
    let particle_presets = [None, None, None, Some(preset)];
    let mut particles = ParticleSystem::with_capacity(8);

    {
        let mut particle_sink =
            ParticleBurstSink::with_presets(&mut particles, None, &particle_presets);
        scene.handle_collisions(
            &mut world,
            &Tilemap::default(),
            &mut audio_events,
            0.0,
            None,
            None,
            Some(&mut particle_sink),
            None,
        );
    }
    {
        let mut particle_sink =
            ParticleBurstSink::with_presets(&mut particles, None, &particle_presets);
        scene.handle_collisions(
            &mut world,
            &Tilemap::default(),
            &mut audio_events,
            0.0,
            None,
            None,
            Some(&mut particle_sink),
            None,
        );
    }

    assert_eq!(scene.game_state(), GameState::Playing);
    assert_eq!(world.healths[player.id as usize], Some(8.0));
    assert_eq!(particles.particle_count(), 2);
    assert!(audio_events.is_empty());
}

#[test]
fn player_pickup_collision_increments_score_once_and_despawns_pickup() {
    let (mut scene, mut world, _, mut audio_events) = playing_scene();
    let mut gameplay_events = Vec::new();
    let player = world.player.unwrap();
    world.set_transform(player, Transform2D { x: 50.0, y: 50.0 });
    let pickup = world.spawn_entity();
    world.set_transform(pickup, Transform2D { x: 50.0, y: 50.0 });
    world.set_aabb_collider(
        pickup,
        AabbCollider::new(8.0, 8.0, true, CollisionLayer::Pickup),
    );
    assert!(world.set_pickup(pickup, Pickup::new(GAMEPLAY_PICKUP_ITEM_SCORE, 3, true),));

    {
        let mut gameplay_sink = GameplayEventSink::new(&mut gameplay_events);
        scene.handle_collisions(
            &mut world,
            &Tilemap::default(),
            &mut audio_events,
            0.0,
            None,
            Some(&mut gameplay_sink),
            None,
            None,
        );
    }

    assert!(world.alive[player.id as usize]);
    assert!(!world.alive[pickup.id as usize]);
    assert_eq!(scene.score(), 3);
    assert_eq!(gameplay_events.len(), 1);
    assert_eq!(gameplay_events[0].kind, GAMEPLAY_EVENT_PICKUP_COLLECTED);
    assert_eq!(gameplay_events[0].actor_id, player.id);
    assert_eq!(gameplay_events[0].source_id, pickup.id);
    assert_eq!(gameplay_events[0].token_id, GAMEPLAY_PICKUP_ITEM_SCORE);
    assert_eq!(gameplay_events[0].payload_bits, 3);
    assert_eq!(
        gameplay_events[0].flags & GAMEPLAY_EVENT_FLAG_TARGET_REMOVED,
        GAMEPLAY_EVENT_FLAG_TARGET_REMOVED,
    );

    scene.handle_collisions(
        &mut world,
        &Tilemap::default(),
        &mut audio_events,
        0.0,
        None,
        None,
        None,
        None,
    );
    assert_eq!(scene.score(), 3);
}

#[test]
fn player_pickup_score_commit_saturates_at_u32_max() {
    let (mut scene, mut world, _, mut audio_events) = playing_scene();
    scene.score = u32::MAX - 1;
    let player = world.player.unwrap();
    world.set_transform(player, Transform2D { x: 50.0, y: 50.0 });
    let pickup = world.spawn_entity();
    world.set_transform(pickup, Transform2D { x: 50.0, y: 50.0 });
    world.set_aabb_collider(
        pickup,
        AabbCollider::new(8.0, 8.0, true, CollisionLayer::Pickup),
    );
    assert!(world.set_pickup(pickup, Pickup::new(GAMEPLAY_PICKUP_ITEM_SCORE, 3, true),));

    scene.handle_collisions(
        &mut world,
        &Tilemap::default(),
        &mut audio_events,
        0.0,
        None,
        None,
        None,
        None,
    );

    assert_eq!(scene.score(), u32::MAX);
}

#[test]
fn authored_pickup_collision_sound_and_particle_keep_default_collection() {
    let (mut scene, mut world, _, mut audio_events) = playing_scene();
    let mut gameplay_events = Vec::new();
    let player = world.player.unwrap();
    world.set_transform(player, Transform2D { x: 50.0, y: 50.0 });
    let pickup = world.spawn_entity();
    world.set_transform(pickup, Transform2D { x: 50.0, y: 50.0 });
    world.set_aabb_collider(
        pickup,
        AabbCollider::new(8.0, 8.0, true, CollisionLayer::Pickup),
    );
    assert!(world.set_pickup(pickup, Pickup::new(GAMEPLAY_PICKUP_ITEM_SCORE, 3, true)));
    assert!(world.add_collision_reaction(
        pickup,
        CollisionReaction::PlaySound {
            sound_id: 9,
            volume: 0.75,
            pitch: 1.1,
            cooldown: Cooldown::ready(0.0),
            replace_default: false,
            trigger: CollisionReactionTrigger::Enter,
        },
    ));
    assert!(world.add_collision_reaction(
        pickup,
        CollisionReaction::SpawnParticle {
            preset_id: 3,
            target: CollisionTarget::SelfEntity,
            cooldown: Cooldown::ready(0.0),
            replace_default: false,
            trigger: CollisionReactionTrigger::Enter,
        },
    ));

    let mut preset = ParticlePreset::new(DEFAULT_TEXTURE_ID);
    preset.burst_count = 2;
    let particle_presets = [None, None, None, Some(preset)];
    let mut particles = ParticleSystem::with_capacity(8);
    {
        let mut gameplay_sink = GameplayEventSink::new(&mut gameplay_events);
        let mut particle_sink =
            ParticleBurstSink::with_presets(&mut particles, None, &particle_presets);
        scene.handle_collisions(
            &mut world,
            &Tilemap::default(),
            &mut audio_events,
            0.0,
            None,
            Some(&mut gameplay_sink),
            Some(&mut particle_sink),
            None,
        );
    }

    assert!(!world.alive[pickup.id as usize]);
    assert_eq!(scene.score(), 3);
    assert_eq!(audio_events.len(), 1);
    assert_eq!(audio_events[0].sound_id, 9.0);
    assert_eq!(particles.particle_count(), 2);
    assert_eq!(gameplay_events.len(), 1);
    assert_eq!(gameplay_events[0].kind, GAMEPLAY_EVENT_PICKUP_COLLECTED);
}

#[test]
fn authored_pickup_collision_reaction_collects_before_followup_despawn() {
    let (mut scene, mut world, _, mut audio_events) = playing_scene();
    let mut gameplay_events = Vec::new();
    let player = world.player.unwrap();
    world.set_transform(player, Transform2D { x: 50.0, y: 50.0 });
    let pickup = world.spawn_entity();
    world.set_transform(pickup, Transform2D { x: 50.0, y: 50.0 });
    world.set_aabb_collider(
        pickup,
        AabbCollider::new(8.0, 8.0, true, CollisionLayer::Pickup),
    );
    assert!(world.set_pickup(pickup, Pickup::new(GAMEPLAY_PICKUP_ITEM_SCORE, 3, true)));
    assert!(world.add_collision_reaction(
        pickup,
        CollisionReaction::Pickup {
            target: CollisionTarget::SelfEntity,
        },
    ));
    assert!(world.add_collision_reaction(
        pickup,
        CollisionReaction::Despawn {
            target: CollisionTarget::SelfEntity,
        },
    ));

    {
        let mut gameplay_sink = GameplayEventSink::new(&mut gameplay_events);
        scene.handle_collisions(
            &mut world,
            &Tilemap::default(),
            &mut audio_events,
            0.0,
            None,
            Some(&mut gameplay_sink),
            None,
            None,
        );
    }

    assert!(!world.alive[pickup.id as usize]);
    assert_eq!(scene.score(), 3);
    assert_eq!(gameplay_events.len(), 1);
    assert_eq!(gameplay_events[0].kind, GAMEPLAY_EVENT_PICKUP_COLLECTED);
    assert_eq!(gameplay_events[0].actor_id, player.id);
    assert_eq!(gameplay_events[0].source_id, pickup.id);
    assert_eq!(gameplay_events[0].payload_bits, 3);
}

#[test]
fn authored_player_side_pickup_reaction_collects_other_pickup_once() {
    let (mut scene, mut world, _, mut audio_events) = playing_scene();
    let mut gameplay_events = Vec::new();
    let player = world.player.unwrap();
    world.set_transform(player, Transform2D { x: 50.0, y: 50.0 });
    let pickup = world.spawn_entity();
    world.set_transform(pickup, Transform2D { x: 50.0, y: 50.0 });
    world.set_aabb_collider(
        pickup,
        AabbCollider::new(8.0, 8.0, true, CollisionLayer::Pickup),
    );
    assert!(world.set_pickup(pickup, Pickup::new(GAMEPLAY_PICKUP_ITEM_SCORE, 5, true)));
    assert!(world.add_collision_reaction(
        player,
        CollisionReaction::Pickup {
            target: CollisionTarget::OtherEntity,
        },
    ));
    assert!(world.add_collision_reaction(
        player,
        CollisionReaction::Despawn {
            target: CollisionTarget::OtherEntity,
        },
    ));

    {
        let mut gameplay_sink = GameplayEventSink::new(&mut gameplay_events);
        scene.handle_collisions(
            &mut world,
            &Tilemap::default(),
            &mut audio_events,
            0.0,
            None,
            Some(&mut gameplay_sink),
            None,
            None,
        );
    }

    assert!(!world.alive[pickup.id as usize]);
    assert_eq!(scene.score(), 5);
    assert_eq!(gameplay_events.len(), 1);
    assert_eq!(gameplay_events[0].actor_id, player.id);
    assert_eq!(gameplay_events[0].source_id, pickup.id);
    assert_eq!(gameplay_events[0].payload_bits, 5);
}

#[test]
fn authored_pickup_reaction_suppresses_legacy_fallback_when_target_is_not_pickup() {
    let (mut scene, mut world, _, mut audio_events) = playing_scene();
    let mut gameplay_events = Vec::new();
    let player = world.player.unwrap();
    world.set_transform(player, Transform2D { x: 50.0, y: 50.0 });
    let pickup = world.spawn_entity();
    world.set_transform(pickup, Transform2D { x: 50.0, y: 50.0 });
    world.set_aabb_collider(
        pickup,
        AabbCollider::new(8.0, 8.0, true, CollisionLayer::Pickup),
    );
    assert!(world.set_pickup(pickup, Pickup::new(GAMEPLAY_PICKUP_ITEM_SCORE, 5, true)));
    assert!(world.add_collision_reaction(
        player,
        CollisionReaction::Pickup {
            target: CollisionTarget::SelfEntity,
        },
    ));

    {
        let mut gameplay_sink = GameplayEventSink::new(&mut gameplay_events);
        scene.handle_collisions(
            &mut world,
            &Tilemap::default(),
            &mut audio_events,
            0.0,
            None,
            Some(&mut gameplay_sink),
            None,
            None,
        );
    }

    assert!(world.alive[pickup.id as usize]);
    assert_eq!(scene.score(), 0);
    assert!(gameplay_events.is_empty());
}

#[test]
fn player_pickup_collision_does_not_trigger_enemy_game_over() {
    let (mut scene, mut world, _, mut audio_events) = playing_scene();
    let player = world.player.unwrap();
    world.set_transform(player, Transform2D { x: 50.0, y: 50.0 });
    let pickup = world.spawn_entity();
    world.set_transform(pickup, Transform2D { x: 50.0, y: 50.0 });
    world.set_aabb_collider(
        pickup,
        AabbCollider::new(8.0, 8.0, true, CollisionLayer::Pickup),
    );
    assert!(world.set_pickup(pickup, Pickup::new(GAMEPLAY_PICKUP_ITEM_SCORE, 1, true),));

    scene.handle_collisions(
        &mut world,
        &Tilemap::default(),
        &mut audio_events,
        0.0,
        None,
        None,
        None,
        None,
    );

    assert_eq!(scene.game_state(), GameState::Playing);
    assert_eq!(scene.score(), 1);
}

#[test]
fn score_reward_is_added_when_enemy_dies() {
    let (mut scene, mut world, mut camera, mut audio_events) = playing_scene();
    scene.set_combat(&mut world, &mut camera, &mut audio_events, 2.0, 2.0, 7);
    let b = world.spawn_bullet_from_template(
        Transform2D { x: 50.0, y: 50.0 },
        Velocity::default(),
        DEFAULT_TEXTURE_ID,
        DEFAULT_BULLET_LIFETIME,
        scene.config.bullet_template,
        scene.config.bullet_damage,
    );
    let e = world.spawn_enemy_from_template(
        52.0,
        50.0,
        DEFAULT_TEXTURE_ID,
        scene.config.enemy_template,
        scene.config.enemy_health,
        scene.config.score_reward,
    );

    scene.handle_collisions(
        &mut world,
        &Tilemap::default(),
        &mut audio_events,
        0.0,
        None,
        None,
        None,
        None,
    );

    assert!(!world.alive[b.id as usize]);
    assert!(!world.alive[e.id as usize]);
    assert_eq!(scene.score(), 7);
}

#[test]
fn multiple_bullets_kill_one_enemy_once() {
    let (mut scene, mut world, mut camera, mut audio_events) = playing_scene();
    scene.set_combat(&mut world, &mut camera, &mut audio_events, 1.0, 1.0, 7);
    let first_bullet = world.spawn_bullet(50.0, 50.0, 0.0, 0.0, DEFAULT_TEXTURE_ID);
    let second_bullet = world.spawn_bullet(51.0, 50.0, 0.0, 0.0, DEFAULT_TEXTURE_ID);
    let enemy = world.spawn_enemy_from_template(
        52.0,
        50.0,
        DEFAULT_TEXTURE_ID,
        scene.config.enemy_template,
        scene.config.enemy_health,
        scene.config.score_reward,
    );

    scene.handle_collisions(
        &mut world,
        &Tilemap::default(),
        &mut audio_events,
        0.0,
        None,
        None,
        None,
        None,
    );

    assert!(!world.alive[first_bullet.id as usize]);
    assert!(world.alive[second_bullet.id as usize]);
    assert!(!world.alive[enemy.id as usize]);
    assert_eq!(scene.score(), 7);
}

#[test]
fn one_bullet_scores_once_when_overlapping_multiple_enemies() {
    let (mut scene, mut world, _, mut audio_events) = playing_scene();
    let bullet = world.spawn_bullet(50.0, 50.0, 0.0, 0.0, DEFAULT_TEXTURE_ID);
    let first_enemy = world.spawn_enemy(52.0, 50.0, DEFAULT_TEXTURE_ID);
    let second_enemy = world.spawn_enemy(54.0, 50.0, DEFAULT_TEXTURE_ID);

    scene.handle_collisions(
        &mut world,
        &Tilemap::default(),
        &mut audio_events,
        0.0,
        None,
        None,
        None,
        None,
    );

    assert!(!world.alive[bullet.id as usize]);
    assert!(!world.alive[first_enemy.id as usize]);
    assert!(world.alive[second_enemy.id as usize]);
    assert_eq!(scene.score(), 1);
}

fn projectile_tilemap(blocks_projectile: bool, height_span: Option<HeightSpan>) -> Tilemap {
    let mut tilemap = Tilemap::default();
    tilemap.set_tile_definition(1, 7, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0);
    if !blocks_projectile {
        assert!(tilemap.set_tile_hd2d_definition(
            1,
            Hd2dTileKind::Flat.code(),
            true,
            false,
            true,
            height_span.map_or(0.0, |span| span.height),
            false,
            0,
            0.0,
            0.0,
        ));
    }
    if let Some(span) = height_span {
        assert!(tilemap.set_tile_height_span_definition(
            1,
            span.floor.0,
            span.elevation,
            span.height,
        ));
    }
    tilemap.set_layer(0, 1, 1, 32.0, 32.0, 48.0, 34.0, true, vec![1]);
    tilemap
}
