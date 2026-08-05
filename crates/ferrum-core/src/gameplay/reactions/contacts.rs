use super::*;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) struct CollisionContactKey {
    a_id: u32,
    a_generation: u32,
    b_id: u32,
    b_generation: u32,
}

impl CollisionContactKey {
    pub(crate) fn new(a: Entity, b: Entity) -> Self {
        let a_key = (a.id, a.generation);
        let b_key = (b.id, b.generation);
        let (a_key, b_key) = if a_key <= b_key {
            (a_key, b_key)
        } else {
            (b_key, a_key)
        };
        Self {
            a_id: a_key.0,
            a_generation: a_key.1,
            b_id: b_key.0,
            b_generation: b_key.1,
        }
    }
}

#[derive(Debug, Default)]
pub(crate) struct CollisionContactTracker {
    previous_contacts: Vec<CollisionContactKey>,
    current_contacts: Vec<CollisionContactKey>,
    max_contacts: usize,
}

impl CollisionContactTracker {
    pub(crate) fn with_capacity(max_contacts: usize) -> Self {
        Self {
            previous_contacts: Vec::with_capacity(max_contacts),
            current_contacts: Vec::with_capacity(max_contacts),
            max_contacts,
        }
    }

    pub(crate) fn clear(&mut self) {
        self.previous_contacts.clear();
        self.current_contacts.clear();
    }

    pub(crate) fn clear_current(&mut self) {
        self.current_contacts.clear();
    }

    pub(crate) fn register(&mut self, first: Entity, second: Entity) -> bool {
        register_collision_contact(
            &self.previous_contacts,
            &mut self.current_contacts,
            self.max_contacts,
            first,
            second,
        )
    }

    pub(crate) fn finish(&mut self) {
        finish_collision_contacts(&mut self.previous_contacts, &mut self.current_contacts);
    }

    #[cfg(test)]
    pub(crate) fn current_len(&self) -> usize {
        self.current_contacts.len()
    }

    #[cfg(test)]
    pub(crate) fn current_capacity(&self) -> usize {
        self.current_contacts.capacity()
    }
}

pub(crate) fn register_collision_contact(
    previous_contacts: &[CollisionContactKey],
    current_contacts: &mut Vec<CollisionContactKey>,
    max_contacts: usize,
    first: Entity,
    second: Entity,
) -> bool {
    let key = CollisionContactKey::new(first, second);
    let insert_index = match current_contacts.binary_search(&key) {
        Ok(_) => return false,
        Err(insert_index) => insert_index,
    };
    let contact_entered = previous_contacts.binary_search(&key).is_err();
    if current_contacts.len() >= max_contacts {
        return false;
    }
    current_contacts.insert(insert_index, key);
    contact_entered
}

pub(crate) fn finish_collision_contacts(
    previous_contacts: &mut Vec<CollisionContactKey>,
    current_contacts: &mut Vec<CollisionContactKey>,
) {
    std::mem::swap(previous_contacts, current_contacts);
    current_contacts.clear();
}
