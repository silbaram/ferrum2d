#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Entity {
    pub id: u32,
    pub generation: u32,
}
