use super::World;
use crate::components::gameplay::{
    GameplayFaction, GameplayTags, GAMEPLAY_TAG_MAX_ID, GAMEPLAY_TAG_PRIMARY_ACTOR,
};

impl World {
    pub(crate) fn gameplay_faction_indices(&self, faction_id: u32) -> &[usize] {
        self.gameplay_faction_indices
            .get(faction_id as usize)
            .map(Vec::as_slice)
            .unwrap_or_default()
    }

    pub(crate) fn gameplay_tag_indices(&self, tag_id: u32) -> &[usize] {
        self.gameplay_tag_indices
            .get(tag_id as usize)
            .map(Vec::as_slice)
            .unwrap_or_default()
    }

    pub(crate) fn set_gameplay_faction_at_index(&mut self, index: usize, faction: GameplayFaction) {
        self.clear_gameplay_faction_at_index(index);
        self.gameplay_factions[index] = Some(faction);
        self.gameplay_faction_indices[faction.faction_id as usize].push(index);
    }

    pub(crate) fn clear_gameplay_faction_at_index(&mut self, index: usize) {
        let Some(faction) = self.gameplay_factions[index] else {
            return;
        };
        remove_index(
            &mut self.gameplay_faction_indices[faction.faction_id as usize],
            index,
        );
        self.gameplay_factions[index] = None;
    }

    pub(crate) fn set_gameplay_tags_at_index(&mut self, index: usize, tags: GameplayTags) {
        self.clear_gameplay_tags_at_index(index);
        let tags = self.with_engine_gameplay_markers_at_index(index, tags);
        self.gameplay_tags[index] = Some(tags);
        for tag_id in 0..=GAMEPLAY_TAG_MAX_ID {
            if tags.contains(tag_id) {
                self.gameplay_tag_indices[tag_id as usize].push(index);
            }
        }
    }

    pub(crate) fn clear_gameplay_tags_at_index(&mut self, index: usize) {
        let Some(tags) = self.gameplay_tags[index] else {
            return;
        };
        for tag_id in 0..=GAMEPLAY_TAG_MAX_ID {
            if tags.contains(tag_id) {
                remove_index(&mut self.gameplay_tag_indices[tag_id as usize], index);
            }
        }
        self.gameplay_tags[index] = None;
    }

    pub(crate) fn clear_gameplay_query_indices_at_index(&mut self, index: usize) {
        self.clear_gameplay_faction_at_index(index);
        self.clear_gameplay_tags_at_index(index);
    }

    pub(crate) fn rebuild_gameplay_query_indices(&mut self) {
        for indices in &mut self.gameplay_faction_indices {
            indices.clear();
        }
        for indices in &mut self.gameplay_tag_indices {
            indices.clear();
        }
        for alive_position in 0..self.alive_indices().len() {
            let index = self.alive_indices()[alive_position];
            if let Some(faction) = self.gameplay_factions[index] {
                self.gameplay_faction_indices[faction.faction_id as usize].push(index);
            }
            if let Some(tags) = self.gameplay_tags[index] {
                for tag_id in 0..=GAMEPLAY_TAG_MAX_ID {
                    if tags.contains(tag_id) {
                        self.gameplay_tag_indices[tag_id as usize].push(index);
                    }
                }
            }
        }
    }

    #[cfg(test)]
    pub(crate) fn gameplay_faction_query_indices(&self, faction_id: u32) -> &[usize] {
        self.gameplay_faction_indices(faction_id)
    }

    #[cfg(test)]
    pub(crate) fn gameplay_tag_query_indices(&self, tag_id: u32) -> &[usize] {
        self.gameplay_tag_indices(tag_id)
    }
}

impl World {
    fn with_engine_gameplay_markers_at_index(
        &self,
        index: usize,
        tags: GameplayTags,
    ) -> GameplayTags {
        let Some(primary_actor) = self.primary_actor else {
            return tags;
        };
        if primary_actor.id as usize == index && self.is_current_entity(primary_actor) {
            return tags.with_tag(GAMEPLAY_TAG_PRIMARY_ACTOR);
        }
        tags
    }
}

fn remove_index(indices: &mut Vec<usize>, index: usize) {
    if let Some(position) = indices.iter().position(|candidate| *candidate == index) {
        indices.swap_remove(position);
    }
}
