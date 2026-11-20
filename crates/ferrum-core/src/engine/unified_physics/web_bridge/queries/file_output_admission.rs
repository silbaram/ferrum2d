use super::*;
use crate::engine::file_physics_output_admission::{self as f, Budget, Error, Problem};
impl QueryBuffers {
    pub(in crate::engine) fn validate_file_output(&self, b: &mut Budget) -> Result<(), Error> {
        let Self {
            hits: _,
            summaries: _,
        } = self;
        b.work(2)?;
        b.vector(&self.hits)?;
        b.vector(&self.summaries)?;
        f::require(
            self.hits.len() <= MAX_HITS && self.summaries.len() <= MAX_QUERIES,
            "unified_queries",
            "lengths",
            0,
            Problem::Length,
        )?;
        let mut end = 0usize;
        for (i, s) in self.summaries.iter().enumerate() {
            b.work(3)?;
            let next = (s[0] as usize)
                .checked_add(s[1] as usize)
                .ok_or(Error::WorkLimit)?;
            f::require(
                s[0] as usize == end && next <= self.hits.len() && s[2] <= 1,
                "unified_queries",
                "summaries",
                i,
                Problem::Graph,
            )?;
            b.work(next - end)?;
            let mut kind = None;
            for j in end..next {
                let v = &self.hits[j];
                let HitRecord {
                    query: _,
                    kind: _,
                    flags: _,
                    entity: _,
                    body: _,
                    collider: _,
                    value: _,
                    point: _,
                    normal: _,
                    terrain: _,
                } = v;
                b.work(19)?;
                f::require(
                    v.query as usize == i && v.kind <= 4 && kind.is_none_or(|k| k == v.kind),
                    "unified_queries",
                    "hit_query",
                    j,
                    Problem::Reference,
                )?;
                kind = Some(v.kind);
                let mask = match v.kind {
                    3 => 7,
                    4 => 11,
                    _ => 3,
                };
                f::require(
                    v.flags & !mask == 0
                        && (v.flags & 1 != 0 || v.entity == [0; 2])
                        && terrain(v.terrain),
                    "unified_queries",
                    "metadata",
                    j,
                    Problem::Flags,
                )?;
                f::require(
                    v.value.is_finite()
                        && v.value >= 0.0
                        && f::finite(&v.point)
                        && f::finite(&v.normal)
                        && (v.kind != 3 || v.value <= 1.0),
                    "unified_queries",
                    "values",
                    j,
                    Problem::Number,
                )?;
                if matches!(v.kind, 1 | 2) {
                    f::require(
                        v.value == 0.0 && v.point == [0.0; 3] && v.normal == [0.0; 3],
                        "unified_queries",
                        "overlap_unused",
                        j,
                        Problem::Canonical,
                    )?;
                }
                if v.kind == 4 {
                    f::require(
                        v.normal == [0.0; 3],
                        "unified_queries",
                        "nearest_unused",
                        j,
                        Problem::Canonical,
                    )?;
                }
            }
            end = next;
        }
        f::require(
            end == self.hits.len(),
            "unified_queries",
            "coverage",
            0,
            Problem::Graph,
        )
    }
}
fn terrain(v: [u32; 3]) -> bool {
    match v[0] {
        0 => v == [0; 3],
        1 => true,
        2 => v[2] == 0,
        _ => false,
    }
}

#[cfg(test)]
impl QueryBuffers {
    pub(in crate::engine) fn corrupt_output(&mut self, case: u32) {
        match case {
            0 => self.summaries[0][0] = 1,
            1 => self.hits[0].kind = 5,
            2 => self.hits[0].query = 5,
            3 => self.hits[0].value = f32::NAN,
            _ => self.hits[0].terrain = [3, 0, 0],
        }
    }
}
