//! Matrix-free active contact solve. Work is bounded by the contact graph;
//! dynamic linear/angular inverse mass stays in the same contact Jacobian.
use super::{Node, Row};
use rapier3d::prelude as rp;

#[derive(Default)]
pub(super) struct Scratch {
    active: Vec<bool>,
    residual: Vec<f64>,
    direction: Vec<f64>,
    product: Vec<f64>,
    impulse: Vec<f64>,
    linear: Vec<rp::Vector>,
    angular: Vec<rp::Vector>,
    saved: Vec<(rp::Vector, rp::Vector)>,
}

impl Scratch {
    pub(super) fn try_reserve(
        &mut self,
        nodes: usize,
        rows: usize,
    ) -> Result<(), std::collections::TryReserveError> {
        self.active
            .try_reserve(rows.saturating_sub(self.active.len()))?;
        self.residual
            .try_reserve(rows.saturating_sub(self.residual.len()))?;
        self.direction
            .try_reserve(rows.saturating_sub(self.direction.len()))?;
        self.product
            .try_reserve(rows.saturating_sub(self.product.len()))?;
        self.impulse
            .try_reserve(rows.saturating_sub(self.impulse.len()))?;
        self.linear
            .try_reserve(nodes.saturating_sub(self.linear.len()))?;
        self.angular
            .try_reserve(nodes.saturating_sub(self.angular.len()))?;
        self.saved
            .try_reserve(nodes.saturating_sub(self.saved.len()))?;
        Ok(())
    }
}

fn multiply(nodes: &mut [Node], rows: &[Row], s: &mut Scratch) {
    s.linear.fill(rp::Vector::ZERO);
    s.angular.fill(rp::Vector::ZERO);
    for (row, &value) in rows.iter().zip(&s.direction) {
        nodes[row.a].visits += 2;
        if let Some(b) = row.b {
            nodes[b].visits += 2;
        }
        let impulse = row.normal * value as f32;
        s.linear[row.a] += impulse * nodes[row.a].inv_mass;
        s.angular[row.a] +=
            nodes[row.a].inv_inertia * (row.point - nodes[row.a].center).cross(impulse);
        if let Some(b) = row.b {
            s.linear[b] -= impulse * nodes[b].inv_mass;
            s.angular[b] -= nodes[b].inv_inertia * (row.point - nodes[b].center).cross(impulse);
        }
    }
    for ((row, out), &active) in rows.iter().zip(&mut s.product).zip(&s.active) {
        let a = s.linear[row.a] + s.angular[row.a].cross(row.point - nodes[row.a].center);
        let b = row.b.map_or(rp::Vector::ZERO, |b| {
            s.linear[b] + s.angular[b].cross(row.point - nodes[b].center)
        });
        *out = if active {
            f64::from((a - b).dot(row.normal))
        } else {
            0.
        };
    }
}

pub(super) fn solve(
    nodes: &mut [Node],
    rows: &mut [Row],
    s: &mut Scratch,
    include_resting: bool,
) -> bool {
    s.active.clear();
    s.residual.clear();
    for row in rows.iter() {
        let target = row
            .b
            .map_or(row.target_velocity, |b| nodes[b].point_velocity(row.point));
        let mut residual = -(nodes[row.a].point_velocity(row.point) - target).dot(row.normal);
        if row.minimum_velocity != 0. {
            residual += row.minimum_velocity;
        }
        // A resting row in a centered patch can carry load when another row
        // stops its neighbor during this same solve.
        let active =
            row.impulse > 1.0e-6 || residual > 1.0e-5 || (include_resting && residual == 0.);
        s.active.push(active);
        s.residual
            .push(if active { f64::from(residual) } else { 0. });
    }
    s.direction.clone_from(&s.residual);
    s.product.resize(rows.len(), 0.);
    s.impulse.clear();
    s.impulse.resize(rows.len(), 0.);
    s.linear.resize(nodes.len(), rp::Vector::ZERO);
    s.angular.resize(nodes.len(), rp::Vector::ZERO);
    let mut squared = s.residual.iter().map(|v| v * v).sum::<f64>();
    let mut converged = false;
    for _ in 0..rows.len().saturating_mul(2).min(4096) {
        multiply(nodes, rows, s);
        let denominator = s
            .direction
            .iter()
            .zip(&s.product)
            .map(|(p, a)| p * a)
            .sum::<f64>();
        if !denominator.is_finite() || denominator <= f64::EPSILON * squared {
            return false;
        }
        let alpha = squared / denominator;
        for (((impulse, residual), &direction), &product) in s
            .impulse
            .iter_mut()
            .zip(&mut s.residual)
            .zip(&s.direction)
            .zip(&s.product)
        {
            *impulse += alpha * direction;
            *residual -= alpha * product;
        }
        if s.residual.iter().all(|v| v.abs() < 2.0e-6) {
            converged = true;
            break;
        }
        let next = s.residual.iter().map(|v| v * v).sum::<f64>();
        let beta = next / squared;
        for (direction, &residual) in s.direction.iter_mut().zip(&s.residual) {
            *direction = residual + beta * *direction;
        }
        squared = next;
    }
    if !converged
        || rows
            .iter()
            .zip(&s.impulse)
            .any(|(row, delta)| !delta.is_finite() || f64::from(row.impulse) + delta < -1.0e-6)
    {
        return false;
    }
    s.saved.clear();
    s.saved.extend(nodes.iter().map(|n| (n.linear, n.angular)));
    for (row, &delta) in rows.iter().zip(&s.impulse) {
        nodes[row.a].impulse(row.point, row.normal * delta as f32);
        if let Some(b) = row.b {
            nodes[b].impulse(row.point, -row.normal * delta as f32);
        }
    }
    if nodes
        .iter()
        .any(|n| !n.linear.is_finite() || !n.angular.is_finite())
        || rows.iter().any(|row| {
            let target = row
                .b
                .map_or(row.target_velocity, |b| nodes[b].point_velocity(row.point));
            (nodes[row.a].point_velocity(row.point) - target).dot(row.normal)
                < row.minimum_velocity - 1.0e-5
        })
    {
        for (node, &(linear, angular)) in nodes.iter_mut().zip(&s.saved) {
            node.linear = linear;
            node.angular = angular;
        }
        return false;
    }
    for (row, &delta) in rows.iter_mut().zip(&s.impulse) {
        row.impulse = (row.impulse + delta as f32).max(0.);
    }
    true
}
