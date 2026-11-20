//! The SpatialScene field is the noncombat follower. The same Rust storage type
//! is also used by separately owned combat agents/search scratch; those owners
//! must admit their contexts separately, including incremental SearchJob data.
use super::*;
use crate::spatial_scene::file_admission::{
    entity_history, finite, require, span, Budget, Error, Field, Problem,
};

/// Preserve valid heap wire order; reject corrupt order before standard Serde's
/// BinaryHeap::from could repair it. Existing ACTIVE decode bounds the sequence.
pub(super) fn deserialize_open<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> Result<BinaryHeap<Open>, D::Error> {
    let values = <Vec<Open> as serde::Deserialize>::deserialize(d)?;
    if values.len() > MAX_PROBES as usize {
        return Err(serde::de::Error::custom("spatial navigation heap length"));
    }
    for (i, node) in values.iter().enumerate() {
        if node.index >= MAX_NODES + 2
            || !node.score.is_finite()
            || node.score < 0.
            || i != 0 && values[(i - 1) / 2] < *node
        {
            return Err(serde::de::Error::custom(
                "spatial navigation heap payload/order",
            ));
        }
    }
    Ok(BinaryHeap::from(values))
}
fn waypoint(p: Waypoint) -> bool {
    finite(&[p.at.x, p.at.y]) && span(p.span) && p.surface < 256
}
impl SpatialNavigation {
    pub(in crate::spatial_scene) fn validate_file_root(
        &self,
        scene: &SpatialScene,
        world: &World,
        b: &mut Budget,
    ) -> Result<(), Error> {
        b.work(40)?;
        // Only plan_navigation/noncombat plan/update write this field. Incremental
        // jobs live in DataSceneCombat's separate scratch; do not pretend this
        // root-context validator admits those other instances of the shared type.
        require(
            !self.combat
                && !self.precise_stop
                && self.job.is_none()
                && self.steering.is_none()
                && self.combat_step == 0.
                && self.combat_drop == 0.
                && self.frame_limit == 0
                && self.search_peers.is_empty()
                && self.search_padding == 0.
                && self.search_neighbors == 0
                && self.crowd_detour.is_none()
                && self.crowd_candidates == 0
                && self.crowd_step.work == 0
                && self.crowd_step.steering_velocity.is_none()
                && self.crowd_step.neighbor_tests == 0
                && self.crowd_step.yielded == 0
                && self.crowd_step.steered == 0
                && [0, MAX_WORK].contains(&self.work_limit),
            Field::Navigation,
            0,
            Problem::Reference,
        )?;
        require(
            finite(&[self.speed, self.radius, self.cell_size])
                && self.speed >= 0.
                && self.radius >= 0.
                && self.cell_size >= 0.
                && self.pending.is_finite()
                && self.planned <= MAX_NODES + 2,
            Field::Navigation,
            0,
            Problem::Number,
        )?;
        b.work(self.points.len())?;
        require(
            self.points.len() <= MAX_NODES + 2 && self.next <= self.points.len(),
            Field::Navigation,
            0,
            Problem::Length,
        )?;
        if self.status == SpatialMoveStatus::Moving {
            require(
                self.actor.is_some_and(|e| entity_history(world, e))
                    && !self.points.is_empty()
                    && self.planned == self.points.len()
                    && self.speed > 0.
                    && self.cell_size > 0.
                    && self.last.is_some(),
                Field::Navigation,
                0,
                Problem::Reference,
            )?;
        } else {
            require(
                self.actor.is_none()
                    && self.points.is_empty()
                    && self.next == 0
                    && self.pending == 0.,
                Field::Navigation,
                0,
                Problem::Reference,
            )?;
        }
        for (i, p) in self.points.iter().enumerate() {
            require(
                waypoint(*p)
                    && scene
                        .surfaces
                        .get(p.surface)
                        .is_some_and(|s| s.walkable && s.floor == p.span.floor.0),
                Field::Navigation,
                i,
                Problem::Reference,
            )?;
        }
        if let Some((at, height)) = self.last {
            require(
                finite(&[at.x, at.y]) && span(height),
                Field::Navigation,
                0,
                Problem::Number,
            )?;
        }
        if let Some((x, y)) = self.last_motion {
            require(
                x.is_finite() && y.is_finite(),
                Field::Navigation,
                0,
                Problem::Number,
            )?;
        }
        self.search.validate_file(b)
    }
}
impl Search {
    pub(super) fn validate_file(&self, b: &mut Budget) -> Result<(), Error> {
        b.work(self.nodes.len())?;
        b.work(self.cells.len())?;
        b.work(self.open.len())?;
        require(
            self.nodes.len() <= MAX_NODES + 2
                && self.cells.len() <= self.nodes.len()
                && self.open.len() <= MAX_PROBES as usize
                && self.probes <= MAX_PROBES
                && self.expanded as usize <= self.nodes.len(),
            Field::Navigation,
            0,
            Problem::Length,
        )?;
        let mut cell_members = b.vector::<bool>(self.nodes.len())?;
        cell_members.resize(self.nodes.len(), false);
        for (&key, values) in &self.cells {
            b.work(values.len())?;
            require(
                !values.is_empty() && values.len() <= self.nodes.len(),
                Field::Navigation,
                0,
                Problem::Length,
            )?;
            for (i, &index) in values.iter().enumerate() {
                require(
                    index < self.nodes.len(),
                    Field::Navigation,
                    i,
                    Problem::Reference,
                )?;
                require(
                    !cell_members[index]
                        && self.nodes[index].cell == Some(key)
                        && (i == 0 || values[i - 1] < index),
                    Field::Navigation,
                    index,
                    Problem::Cache,
                )?;
                cell_members[index] = true;
            }
        }
        let mut closed = 0;
        let mut zero_roots = 0;
        for (i, node) in self.nodes.iter().enumerate() {
            // configure_surfaces cancels the follower but deliberately retains
            // old search scratch. Its node.surface cannot use current length.
            require(
                waypoint(node.pose)
                    && node.cost >= 0.
                    && (node.cost.is_finite() || node.cost == f64::INFINITY),
                Field::Navigation,
                i,
                Problem::Number,
            )?;
            require(
                cell_members[i] == node.cell.is_some(),
                Field::Navigation,
                i,
                Problem::Cache,
            )?;
            if node.closed {
                closed += 1;
                require(node.cost.is_finite(), Field::Navigation, i, Problem::Cache)?;
            }
            if node.parent == usize::MAX {
                require(
                    node.cost == 0. || node.cost == f64::INFINITY,
                    Field::Navigation,
                    i,
                    Problem::Reference,
                )?;
                zero_roots += usize::from(node.cost == 0.);
            } else {
                require(
                    node.parent < self.nodes.len() && node.parent != i && node.cost.is_finite(),
                    Field::Navigation,
                    i,
                    Problem::Reference,
                )?;
                let parent = &self.nodes[node.parent];
                require(
                    parent.closed && parent.cost.is_finite() && parent.cost <= node.cost,
                    Field::Navigation,
                    i,
                    Problem::Reference,
                )?;
            }
        }
        require(
            closed == self.expanded as usize && zero_roots <= 1,
            Field::Navigation,
            0,
            Problem::Cache,
        )?;
        // Functional parent graph: bounded iterative coloring, no recursive or
        // per-node repeated full chain walk; every edge is visited at most twice.
        b.product(self.nodes.len(), 3)?;
        let mut colors = b.vector::<u8>(self.nodes.len())?;
        colors.resize(self.nodes.len(), 0);
        for start in 0..self.nodes.len() {
            if colors[start] != 0 {
                continue;
            }
            let mut at = start;
            loop {
                if colors[at] == 2 {
                    break;
                }
                require(colors[at] == 0, Field::Navigation, at, Problem::Reference)?;
                colors[at] = 1;
                let parent = self.nodes[at].parent;
                if parent == usize::MAX {
                    break;
                }
                at = parent;
            }
            let mut at = start;
            while colors[at] == 1 {
                colors[at] = 2;
                let parent = self.nodes[at].parent;
                if parent == usize::MAX {
                    break;
                }
                at = parent;
            }
        }
        let heap = self.open.as_slice();
        for (i, node) in heap.iter().enumerate() {
            require(
                node.index < self.nodes.len()
                    && node.score.is_finite()
                    && node.score >= self.nodes[node.index].cost,
                Field::Navigation,
                i,
                Problem::Reference,
            )?;
            if i != 0 {
                require(
                    heap[(i - 1) / 2] >= *node,
                    Field::Navigation,
                    i,
                    Problem::Order,
                )?;
            }
        }
        Ok(())
    }
}
#[cfg(test)]
impl SpatialNavigation {
    pub(crate) fn corrupt_file_fixture(&mut self, case: u32) {
        match case {
            0 => self.next = usize::MAX,
            1 => self.combat = true,
            2 => {
                let count = self.search.nodes.len();
                self.search.nodes.last_mut().unwrap().parent = count;
            }
            3 => self.search.nodes[0].cost = f64::NAN,
            4 => self
                .search
                .cells
                .values_mut()
                .next()
                .unwrap()
                .push(usize::MAX),
            5 => {
                self.search.nodes[0].parent = 1;
                self.search.nodes[1].parent = 0;
                self.search.nodes[0].cost = 0.;
                self.search.nodes[1].cost = 0.;
                self.search.nodes[0].closed = true;
                self.search.nodes[1].closed = true;
                self.search.expanded = self.search.nodes.iter().filter(|n| n.closed).count() as u32;
            }
            _ => unreachable!(),
        }
    }
}

#[cfg(test)]
impl SpatialNavigation {
    pub(crate) fn malformed_file_heap_packet(&self, packet: &[u8]) -> Vec<u8> {
        let mut values = self.search.open.as_slice().to_vec();
        let old = crate::checkpoint_codec::encode(&values).unwrap();
        let old = &old[32..];
        let index = values
            .iter()
            .enumerate()
            .skip(1)
            .filter(|(_, v)| values[0] > **v)
            .min_by(|(_, a), (_, b)| a.cmp(b))
            .map(|(i, _)| i)
            .expect("actual A* leaves a nontrivial heap");
        values.swap(0, index);
        assert!(values
            .iter()
            .enumerate()
            .skip(1)
            .any(|(i, v)| values[(i - 1) / 2] < *v));
        let new = crate::checkpoint_codec::encode(&values).unwrap();
        let new = &new[32..];
        assert_eq!(old.len(), new.len());
        let matches: Vec<_> = packet
            .windows(old.len())
            .enumerate()
            .filter(|(_, v)| *v == old)
            .map(|(i, _)| i)
            .collect();
        assert_eq!(matches.len(), 1);
        let mut out = packet.to_vec();
        out[matches[0]..matches[0] + new.len()].copy_from_slice(new);
        let mut crc = !0u32;
        for &byte in &out[32..] {
            crc ^= u32::from(byte);
            for _ in 0..8 {
                crc = (crc >> 1) ^ (0xedb88320 & 0u32.wrapping_sub(crc & 1));
            }
        }
        out[24..28].copy_from_slice(&(!crc).to_le_bytes());
        out
    }
}

#[cfg(test)]
impl SpatialNavigation {
    pub(crate) fn file_collection_packet(&self, packet: &[u8], duplicate: bool) -> Vec<u8> {
        crate::spatial_scene::file_admission::collection_tests::map_packet(
            packet,
            &self.search.cells,
            duplicate,
        )
    }
}
