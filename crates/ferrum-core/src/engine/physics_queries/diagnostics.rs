use super::super::Engine;
use crate::components::*;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
impl Engine {
    pub fn physics_diagnostics_enabled(&self) -> bool {
        self.world.physics_diagnostics.enabled
    }
    pub fn configure_physics_diagnostics(&mut self, enabled: bool) {
        self.world.physics_diagnostics.enabled = enabled;
        self.world.physics_diagnostics.begin_step();
    }
    /// [dropped, CCD count, joint count, CCD(id,gen,reason)*, joint(type,id,gen,force,torque,error)*]
    pub fn query_physics_diagnostics(&self) -> Vec<f64> {
        let d = &self.world.physics_diagnostics;
        let mut out = vec![d.dropped as f64, d.ccd.len() as f64, d.joints.len() as f64];
        out.extend(d.ccd.iter().flatten().copied());
        out.extend(d.joints.iter().flatten().copied());
        out
    }
    /// Consuming bounded queue. [dropped, (type,id,gen,reason,force,torque)*].
    pub fn drain_physics_joint_breaks(&mut self) -> Vec<f64> {
        let d = &mut self.world.physics_diagnostics;
        let mut out = vec![d.breaks_dropped as f64];
        out.extend(d.breaks.drain(..).flatten());
        d.breaks_dropped = 0;
        out
    }
    pub fn physics_joint_break_force(&self) -> f32 {
        self.physics_joint_snapshot.break_force
    }
    pub fn physics_joint_break_torque(&self) -> f32 {
        self.physics_joint_snapshot.break_torque
    }
    pub fn set_physics_joint_load_limits(
        &mut self,
        kind: u32,
        index: u32,
        generation: u32,
        force: f32,
        torque: f32,
    ) -> bool {
        if force.is_nan() || torque.is_nan() || force < 0.0 || torque < 0.0 {
            return false;
        }
        match kind {
            0 => {
                let id = DistanceJointId { index, generation };
                let Some(mut joint) = self.world.distance_joint(id) else {
                    return false;
                };
                joint.break_force = force;
                joint.break_torque = torque;
                if !self.world.try_set_distance_joint(id, joint) {
                    return false;
                }
                self.store_distance_joint_snapshot(id, joint)
            }
            1 => {
                let id = RopeJointId { index, generation };
                let Some(mut joint) = self.world.rope_joint(id) else {
                    return false;
                };
                joint.break_force = force;
                joint.break_torque = torque;
                if !self.world.try_set_rope_joint(id, joint) {
                    return false;
                }
                self.store_rope_joint_snapshot(id, joint)
            }
            2 => {
                let id = SpringJointId { index, generation };
                let Some(mut joint) = self.world.spring_joint(id) else {
                    return false;
                };
                joint.break_force = force;
                joint.break_torque = torque;
                if !self.world.try_set_spring_joint(id, joint) {
                    return false;
                }
                self.store_spring_joint_snapshot(id, joint)
            }
            3 => {
                let id = RevoluteJointId { index, generation };
                let Some(mut joint) = self.world.revolute_joint(id) else {
                    return false;
                };
                joint.break_force = force;
                joint.break_torque = torque;
                if !self.world.try_set_revolute_joint(id, joint) {
                    return false;
                }
                self.store_revolute_joint_snapshot(id, joint)
            }
            4 => {
                let id = PrismaticJointId { index, generation };
                let Some(mut joint) = self.world.prismatic_joint(id) else {
                    return false;
                };
                joint.break_force = force;
                joint.break_torque = torque;
                if !self.world.try_set_prismatic_joint(id, joint) {
                    return false;
                }
                self.store_prismatic_joint_snapshot(id, joint)
            }
            5 => {
                let id = GearJointId { index, generation };
                let Some(mut joint) = self.world.gear_joint(id) else {
                    return false;
                };
                joint.break_force = force;
                joint.break_torque = torque;
                if !self.world.try_set_gear_joint(id, joint) {
                    return false;
                }
                self.store_gear_joint_snapshot(id, joint)
            }
            6 => {
                let id = WeldJointId { index, generation };
                let Some(mut joint) = self.world.weld_joint(id) else {
                    return false;
                };
                joint.break_force = force;
                joint.break_torque = torque;
                if !self.world.try_set_weld_joint(id, joint) {
                    return false;
                }
                self.store_weld_joint_snapshot(id, joint)
            }
            7 => {
                let id = PulleyJointId { index, generation };
                let Some(mut joint) = self.world.pulley_joint(id) else {
                    return false;
                };
                joint.break_force = force;
                joint.break_torque = torque;
                if !self.world.try_set_pulley_joint(id, joint) {
                    return false;
                }
                self.store_pulley_joint_snapshot(id, joint)
            }
            _ => false,
        }
    }
}
