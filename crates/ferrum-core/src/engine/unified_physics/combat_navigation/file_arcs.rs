//! Private owner traversal for the file-only alias graph.
use super::*;
#[derive(Clone, Copy, Debug)]
pub(in crate::engine) enum NativeRouteArcLocation {
    Agent {
        index: usize,
        entity: Entity,
        route_actor: Option<Entity>,
    },
    Connector {
        entity: Entity,
        target: Entity,
    },
    Cache {
        index: usize,
        target: Entity,
    },
}
impl NativeCombatNavigation {
    pub(in crate::engine) fn file_arc_scan_lengths(&self) -> [usize; 3] {
        [
            self.agents.len(),
            usize::from(self.pending.is_some()),
            self.cache.len(),
        ]
    }
    pub(in crate::engine) fn visit_file_route_arcs<'a, E>(
        &'a self,
        visit: &mut impl FnMut(NativeRouteArcLocation, &'a Arc<[Point]>) -> Result<(), E>,
    ) -> Result<(), E> {
        for (index, agent) in self.agents.iter().enumerate() {
            if let Some((route_actor, points)) = agent.route.file_route_arc() {
                visit(
                    NativeRouteArcLocation::Agent {
                        index,
                        entity: agent.entity,
                        route_actor,
                    },
                    points,
                )?;
            }
        }
        if let Some(Pending {
            entity,
            key,
            kind: JobKind::Connector(points),
            ..
        }) = &self.pending
        {
            visit(
                NativeRouteArcLocation::Connector {
                    entity: *entity,
                    target: key.target,
                },
                points,
            )?;
        }
        self.cache
            .visit_file_route_arcs(&mut |index, target, points| {
                visit(NativeRouteArcLocation::Cache { index, target }, points)
            })
    }
    /// No validation/callback failure is permitted after graph certification.
    pub(in crate::engine) fn rebind_file_route_arcs(
        &mut self,
        replace: &mut impl FnMut(&mut Arc<[Point]>),
    ) {
        for agent in &mut self.agents {
            agent.route.rebind_file_route_arc(replace);
        }
        if let Some(Pending {
            kind: JobKind::Connector(points),
            ..
        }) = &mut self.pending
        {
            replace(points);
        }
        self.cache.rebind_file_route_arcs(replace);
    }
}
