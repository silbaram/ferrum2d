//! Address-independent sort allowance, admitted once before touching scratch.
//! For n>=2 there are fewer than1.5n sift/outer calls. A sift has at most
//! ceil_log2(n) levels, with <=4 loop/compare/swap units per level plus one
//! terminal loop, and one outer unit. Thus6nL+3n <=8n(L+1). n0/1 are trivial.
//! The actual comparison count may vary with allocator addresses; quota never
//! uses that count. Total Key ordering makes the in-place sort infallible after
//! the single checked precharge; no Engine/table backing is touched by sorting.
use super::*;
pub(super) fn work_bound(n: usize) -> Result<u64> {
    let levels = if n <= 1 {
        0
    } else {
        usize::BITS - (n - 1).leading_zeros()
    };
    (n as u64)
        .checked_mul(8)
        .and_then(|n| n.checked_mul(u64::from(levels) + 1))
        .ok_or(Error::Work)
}
fn sift(keys: &mut [Key], mut root: usize, end: usize) {
    loop {
        let Some(child) = root.checked_mul(2).and_then(|n| n.checked_add(1)) else {
            return;
        };
        if child >= end {
            return;
        }
        let mut largest = root;
        if keys[largest] < keys[child] {
            largest = child;
        }
        if child + 1 < end && keys[largest] < keys[child + 1] {
            largest = child + 1;
        }
        if largest == root {
            return;
        }
        keys.swap(root, largest);
        root = largest;
    }
}
pub(super) fn heap(keys: &mut [Key], budget: &mut Budget) -> Result {
    budget.work(work_bound(keys.len())?)?;
    for start in (0..keys.len() / 2).rev() {
        sift(keys, start, keys.len());
    }
    for end in (1..keys.len()).rev() {
        keys.swap(0, end);
        sift(keys, 0, end);
    }
    Ok(())
}
