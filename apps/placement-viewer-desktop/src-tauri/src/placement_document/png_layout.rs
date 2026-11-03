//! Cold-path PNG envelope checks shared by lossless RGBA authoring sources.
fn crc32(bytes: &[u8]) -> u32 {
    let mut value = 0xffff_ffff_u32;
    for byte in bytes {
        value ^= u32::from(*byte);
        for _ in 0..8 {
            value = (value >> 1) ^ if value & 1 == 1 { 0xedb8_8320 } else { 0 };
        }
    }
    value ^ 0xffff_ffff
}
/// Match the browser lossless PNG reader's chunk order, color space and CRC rules.
pub(super) fn rgba8_srgb(bytes: &[u8]) -> bool {
    if !bytes.starts_with(&[137, 80, 78, 71, 13, 10, 26, 10]) {
        return false;
    }
    let mut offset = 8_usize;
    let (mut header, mut palette, mut srgb, mut idat, mut ended) =
        (false, false, false, false, false);
    while let Some(prefix) = bytes.get(offset..offset.saturating_add(8)) {
        let size = u32::from_be_bytes([prefix[0], prefix[1], prefix[2], prefix[3]]) as usize;
        let Some(end) = offset
            .checked_add(size)
            .and_then(|n| n.checked_add(12))
            .filter(|n| *n <= bytes.len())
        else {
            return false;
        };
        let kind = &prefix[4..8];
        let body = &bytes[offset + 8..end - 4];
        if !kind.iter().all(u8::is_ascii_alphabetic)
            || (!header && kind != b"IHDR")
            || crc32(&bytes[offset + 4..end - 4])
                != u32::from_be_bytes(
                    bytes[end - 4..end]
                        .try_into()
                        .expect("four CRC bytes by checked chunk bounds"),
                )
        {
            return false;
        }
        match kind {
            b"IHDR" => {
                if header
                    || size != 13
                    || body[8] != 8
                    || body[9] != 6
                    || body[10] != 0
                    || body[11] != 0
                    || body[12] > 1
                {
                    return false;
                }
                header = true;
            }
            b"IDAT" => {
                if ended {
                    return false;
                }
                idat = true;
            }
            _ => {
                if idat {
                    ended = true;
                }
                if kind == b"IEND" {
                    return size == 0 && idat && end == bytes.len();
                }
                if kind == b"PLTE" {
                    if palette || idat || size == 0 || size > 768 || !size.is_multiple_of(3) {
                        return false;
                    }
                    palette = true;
                } else if kind == b"sRGB" {
                    if srgb || idat || size != 1 || body[0] > 3 {
                        return false;
                    }
                    srgb = true;
                } else if [
                    b"iCCP", b"cICP", b"mDCv", b"cLLi", b"acTL", b"fcTL", b"fdAT",
                ]
                .iter()
                .any(|name| kind == name.as_slice())
                    || (kind == b"gAMA" && body != 45455_u32.to_be_bytes())
                    || (kind == b"cHRM"
                        && (size != 32
                            || body
                                .chunks_exact(4)
                                .zip([31270_u32, 32900, 64000, 33000, 30000, 60000, 15000, 6000])
                                .any(|(v, n)| v != n.to_be_bytes())))
                    || kind[0].is_ascii_uppercase()
                {
                    return false;
                }
            }
        }
        offset = end;
    }
    false
}
