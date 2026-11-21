use super::{candidate, Error};
#[derive(Clone, Debug)]
pub(super) struct Limits {
    pub native: candidate::Limits,
    pub max_output_bytes: usize,
    pub max_metadata_bytes: usize,
}
impl Default for Limits {
    fn default() -> Self {
        Self {
            native: candidate::Limits::default(),
            max_output_bytes: 64 * 1024 * 1024,
            max_metadata_bytes: 64 * 1024 * 1024,
        }
    }
}
impl Limits {
    pub fn words(&self) -> [u32; 27] {
        let n = &self.native;
        [
            1,
            n.framing.max_file_bytes as u32,
            n.framing.max_checksum_bytes as u32,
            n.framing.max_section_bytes[0] as u32,
            n.framing.max_section_bytes[1] as u32,
            n.framing.max_section_bytes[2] as u32,
            n.framing.max_section_bytes[3] as u32,
            n.framing.max_section_bytes[4] as u32,
            n.framing.max_section_bytes[5] as u32,
            n.framing.max_section_bytes[6] as u32,
            n.decode.input_bytes as u32,
            n.decode.allocation_work as u32,
            n.decode.values as u32,
            n.decode.depth as u32,
            n.decode.collection as u32,
            n.decode.zero_sized_elements as u32,
            n.max_checksum_work as u32,
            n.max_allocation_work as u32,
            n.max_post_decode_work as u32,
            n.max_post_decode_scratch_bytes as u32,
            n.max_entity_slots as u32,
            n.max_joint_slots as u32,
            n.max_nested_items as u32,
            n.max_alias_roots as u32,
            n.max_alias_compare_bytes as u32,
            self.max_output_bytes as u32,
            self.max_metadata_bytes as u32,
        ]
    }
    pub fn parse(words: &[u32]) -> Result<Self, Error> {
        let mut result = Self::default();
        if words.is_empty() {
            return Ok(result);
        }
        let defaults = result.words();
        if words.len() != 27
            || words[0] != 1
            || words
                .iter()
                .skip(1)
                .zip(defaults.iter().skip(1))
                .any(|(a, b)| a > b)
        {
            return Err(Error::InvalidLimits);
        }
        let n = &mut result.native;
        n.framing.max_file_bytes = words[1] as usize;
        n.framing.max_checksum_bytes = words[2] as usize;
        for (slot, &v) in n.framing.max_section_bytes.iter_mut().zip(&words[3..10]) {
            *slot = v as usize;
        }
        n.decode.input_bytes = words[10] as usize;
        n.decode.allocation_work = words[11] as usize;
        n.decode.values = words[12] as usize;
        n.decode.depth = words[13] as usize;
        n.decode.collection = words[14] as usize;
        n.decode.zero_sized_elements = words[15] as usize;
        n.max_checksum_work = words[16] as usize;
        n.max_allocation_work = words[17] as usize;
        n.max_post_decode_work = u64::from(words[18]);
        n.max_post_decode_scratch_bytes = words[19] as usize;
        n.max_entity_slots = words[20] as usize;
        n.max_joint_slots = words[21] as usize;
        n.max_nested_items = words[22] as usize;
        n.max_alias_roots = words[23] as usize;
        n.max_alias_compare_bytes = words[24] as usize;
        result.max_output_bytes = words[25] as usize;
        result.max_metadata_bytes = words[26] as usize;
        Ok(result)
    }
}
