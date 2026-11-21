use super::{ProjectileSpawnCommand, ShooterSpawnCommand};
use crate::engine::file_builtin_scenes_admission::{
    entity_history, finite, require, template, Budget, Error, Problem,
};
use crate::world::World;
fn projectile(v: &ProjectileSpawnCommand, b: &mut Budget, i: usize) -> Result<(), Error> {
    b.work(20)?;
    require(
        finite(&[
            v.transform.x,
            v.transform.y,
            v.velocity.vx,
            v.velocity.vy,
            v.lifetime_seconds,
            v.damage,
            v.sound_volume,
            v.sound_pitch,
        ]) && v.sound_volume >= 0.
            && v.sound_pitch > 0.
            && v.source_faction.is_none_or(|f| {
                f.faction_id <= crate::components::gameplay::GAMEPLAY_FACTION_MAX_ID
            }),
        "builtin_shooter",
        "projectile_command",
        i,
        Problem::Number,
    )?;
    template(&v.template, b, "builtin_shooter", i)?;
    if let Some(a) = v.arc {
        require(
            finite(&[a.base_elevation, a.z, a.z_velocity, a.gravity, a.hit_height])
                && a.z >= 0.
                && a.gravity >= 0.
                && a.hit_height >= 0.,
            "builtin_shooter",
            "projectile_arc",
            i,
            Problem::Number,
        )?;
    }
    Ok(())
}
impl ShooterSpawnCommand {
    pub(in crate::shooter_scene) fn validate_file(
        &self,
        w: &World,
        b: &mut Budget,
        i: usize,
    ) -> Result<(), Error> {
        let v = self;
        match v {
            Self::Projectile(v) => projectile(v, b, i),
            Self::Prefab(v) => {
                b.work(12)?;
                require(
                    entity_history(w, v.source)
                        && finite(&[v.transform.x, v.transform.y, v.health]),
                    "builtin_shooter",
                    "prefab_command",
                    i,
                    Problem::Number,
                )?;
                template(&v.template, b, "builtin_shooter", i)?;
                if let Some(p) = &v.projectile {
                    projectile(p, b, i)?;
                }
                Ok(())
            }
        }
    }
}

#[cfg(test)]
impl crate::shooter_scene::ShooterScene {
    pub(crate) fn seed_builtin_captured_finite_action_fixture(
        &mut self,
        w: &World,
        source: crate::entity::Entity,
    ) {
        use crate::components::gameplay::{
            MeleeTarget, ProjectileCollisionTarget, ProjectileTileImpact,
        };
        use crate::components::{Transform2D, Velocity};
        let data = crate::gameplay::ProjectileSpawnCoreData {
            transform: Transform2D { x: 5., y: 7. },
            velocity: Velocity { vx: 1., vy: 0. },
            lifetime_seconds: -0.,
            damage: -3.,
            collision_target: ProjectileCollisionTarget::Enemies,
            tile_impact: ProjectileTileImpact::Despawn,
        };
        let command = self.projectile_spawn_command_from_core_data(w, source, data);
        self.queue_projectile_spawn(command).unwrap();
        self.queue_melee_attack(crate::gameplay::MeleeAttackCoreData {
            attacker: source,
            center: Transform2D { x: 1., y: 2. },
            range: -2.,
            damage: -0.,
            target: MeleeTarget::Enemies,
            height_span: None,
        });
    }
}
