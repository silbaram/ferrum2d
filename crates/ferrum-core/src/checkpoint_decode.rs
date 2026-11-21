//! Cold Postcard admission. Typed allocation work is a conservative request
//! budget, not an allocator/RSS measurement. Native payloads inherit the scope.
use serde::de::{self, DeserializeSeed, EnumAccess, MapAccess, SeqAccess, VariantAccess, Visitor};
use std::{
    cell::{Cell, RefCell},
    fmt, mem,
};

mod enum_admission;

#[derive(Clone, Copy, Debug)]
pub(crate) struct Limits {
    pub input_bytes: usize,
    pub allocation_work: usize,
    pub values: usize,
    pub depth: usize,
    pub collection: usize,
    pub zero_sized_elements: usize,
}
impl Default for Limits {
    fn default() -> Self {
        Self {
            input_bytes: 64 * 1024 * 1024,
            allocation_work: 1024 * 1024 * 1024,
            values: 64 * 1024 * 1024,
            depth: 96,
            collection: 64 * 1024 * 1024,
            zero_sized_elements: 4096,
        }
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Limit {
    Input,
    Allocation,
    Values,
    Depth,
    Collection,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ErrorKind {
    Invalid,
    Trailing,
    Limit(Limit),
    /// A fallible storage reservation failed (including layout overflow),
    /// distinct from the decoder's logical allocation-work quota.
    Allocation,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct Usage {
    pub allocation_work: usize,
    pub values: usize,
    pub peak_depth: usize,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Error {
    pub kind: ErrorKind,
    pub usage: Usage,
}
struct Budget {
    limits: Limits,
    usage: Cell<Usage>,
    depth: Cell<usize>,
    failure: Cell<Option<ErrorKind>>,
}
impl Budget {
    fn remember(&self, failure: ErrorKind) {
        if self.failure.get().is_none() {
            self.failure.set(Some(failure));
        }
    }
    fn reject<E: de::Error>(&self, limit: Limit) -> E {
        self.remember(ErrorKind::Limit(limit));
        E::custom("checkpoint decode budget exceeded")
    }
    fn charge<E: de::Error>(&self, bytes: usize) -> Result<(), E> {
        let mut usage = self.usage.get();
        usage.allocation_work = usage
            .allocation_work
            .checked_add(bytes)
            .filter(|n| *n <= self.limits.allocation_work)
            .ok_or_else(|| self.reject(Limit::Allocation))?;
        self.usage.set(usage);
        Ok(())
    }
    fn enter<E: de::Error>(&self, inline: usize) -> Result<Frame<'_>, E> {
        let depth = self.depth.get() + 1;
        if depth > self.limits.depth {
            return Err(self.reject(Limit::Depth));
        }
        let mut usage = self.usage.get();
        if usage.values >= self.limits.values {
            return Err(self.reject(Limit::Values));
        }
        usage.values += 1;
        usage.peak_depth = usage.peak_depth.max(depth);
        self.usage.set(usage);
        self.charge::<E>(32usize.saturating_add(inline))?;
        self.depth.set(depth);
        Ok(Frame(self))
    }
    fn element<E: de::Error>(&self, index: &mut usize, size: usize) -> Result<(), E> {
        let maximum = if size == 0 {
            self.limits.collection.min(self.limits.zero_sized_elements)
        } else {
            self.limits.collection
        };
        if *index >= maximum {
            return Err(self.reject(Limit::Collection));
        }
        // Covers Vec growth and conservative B-tree node/slot overhead. Explicit
        // saved reservations are charged separately before their allocation.
        let multiplier: usize = if *index == 0 { 11 } else { 3 };
        let bytes = size
            .checked_mul(multiplier)
            .and_then(|n| n.checked_add(128))
            .ok_or_else(|| self.reject(Limit::Allocation))?;
        self.charge::<E>(bytes)?;
        *index += 1;
        Ok(())
    }
    fn error(&self, fallback: ErrorKind) -> Error {
        Error {
            kind: self.failure.get().unwrap_or(fallback),
            usage: self.usage.get(),
        }
    }
}
struct Frame<'a>(&'a Budget);
impl Drop for Frame<'_> {
    fn drop(&mut self) {
        self.0.depth.set(self.0.depth.get() - 1);
    }
}
// The scalar ledger lives directly in const TLS: entering a decode does not
// allocate a management Rc before input/limits can be checked. Nested readers
// borrow the same ledger; Cell counters do not require replacing its storage.
thread_local! { static ACTIVE: RefCell<Option<Budget>> = const { RefCell::new(None) }; }
struct Scope;
impl Drop for Scope {
    fn drop(&mut self) {
        ACTIVE.with(|active| {
            active.replace(None);
        });
    }
}

pub(crate) fn reserve<T>(capacity: usize) -> Result<(), ()> {
    let Some(bytes) = capacity.checked_mul(mem::size_of::<T>()) else {
        ACTIVE.with(|active| {
            if let Some(budget) = active.borrow().as_ref() {
                budget.remember(ErrorKind::Limit(Limit::Allocation));
            }
        });
        return Err(());
    };
    reserve_bytes(bytes)
}
pub(crate) fn reserve_bytes(bytes: usize) -> Result<(), ()> {
    ACTIVE.with(|active| match active.borrow().as_ref() {
        Some(budget) => budget.charge::<postcard::Error>(bytes).map_err(|_| ()),
        None => Ok(()), // Independent public value-data Serde is not this protocol.
    })
}

/// Only an actual try_reserve error enters this path. Do not turn it into a
/// synthetic quota charge: callers must distinguish storage failure from usage.
pub(crate) fn allocation_error<E: de::Error>(_: std::collections::TryReserveError) -> E {
    ACTIVE.with(|active| {
        if let Some(budget) = active.borrow().as_ref() {
            budget.remember(ErrorKind::Allocation);
        }
    });
    E::custom("checkpoint storage reservation failed")
}
pub(crate) fn from_bytes<'de, T: serde::Deserialize<'de>>(bytes: &'de [u8]) -> Result<T, Error> {
    let nested = ACTIVE.with(|active| {
        let stored = active.borrow();
        stored.as_ref().map(|budget| parse(bytes, budget))
    });
    if let Some(result) = nested {
        return result;
    }
    with_limits(bytes, Limits::default()).map(|(value, _)| value)
}

/// Nested file fields must share their outer budget and cannot silently start a
/// fresh default scope. The bytes may be borrowed; the returned value is owned.
pub(crate) fn from_bytes_in_scope<'de, T: serde::Deserialize<'de>>(
    bytes: &'de [u8],
) -> Result<T, Error> {
    ACTIVE.with(|active| {
        let stored = active.borrow();
        let budget = stored.as_ref().ok_or(Error {
            kind: ErrorKind::Invalid,
            usage: Usage::default(),
        })?;
        parse(bytes, budget)
    })
}
pub(crate) fn with_limits<'de, T: serde::Deserialize<'de>>(
    bytes: &'de [u8],
    limits: Limits,
) -> Result<(T, Usage), Error> {
    ACTIVE.with(|active| {
        if active.borrow().is_some() {
            // A nested payload must inherit the active ledger, never reset it.
            return Err(Error {
                kind: ErrorKind::Invalid,
                usage: Usage::default(),
            });
        }
        active.replace(Some(Budget {
            limits,
            usage: Cell::new(Usage::default()),
            depth: Cell::new(0),
            failure: Cell::new(None),
        }));
        // Declare cleanup BEFORE the borrow: every normal/error/unwind return
        // drops all ledger borrows before Scope replaces its TLS storage.
        let _scope = Scope;
        let stored = active.borrow();
        let budget = stored.as_ref().ok_or(Error {
            kind: ErrorKind::Invalid,
            usage: Usage::default(),
        })?;
        let value = parse(bytes, budget)?;
        Ok((value, budget.usage.get()))
    })
}
fn parse<'de, T: serde::Deserialize<'de>>(bytes: &'de [u8], budget: &Budget) -> Result<T, Error> {
    if bytes.len() > budget.limits.input_bytes {
        budget.remember(ErrorKind::Limit(Limit::Input));
        return Err(budget.error(ErrorKind::Invalid));
    }
    let mut source = postcard::Deserializer::from_bytes(bytes);
    let value = T::deserialize(Reader {
        source: &mut source,
        budget,
    })
    .map_err(|_| budget.error(ErrorKind::Invalid))?;
    if budget.failure.get().is_some() {
        return Err(budget.error(ErrorKind::Invalid));
    }
    let trailing = source
        .finalize()
        .map_err(|_| budget.error(ErrorKind::Invalid))?;
    if !trailing.is_empty() {
        return Err(budget.error(ErrorKind::Trailing));
    }
    Ok(value)
}

struct Reader<'a, D> {
    source: D,
    budget: &'a Budget,
}
struct CheckedVisitor<'a, V> {
    visitor: V,
    budget: &'a Budget,
    dynamic: bool,
}
macro_rules! read_simple {
    ($($method:ident),*) => {$(
        fn $method<V: Visitor<'de>>(self, visitor: V) -> Result<V::Value, D::Error> {
            let _frame = self.budget.enter::<D::Error>(0)?;
            self.source.$method(CheckedVisitor { visitor, budget: self.budget, dynamic: false })
        }
    )*};
}
impl<'de, D: de::Deserializer<'de>> de::Deserializer<'de> for Reader<'_, D> {
    type Error = D::Error;
    read_simple!(
        deserialize_any,
        deserialize_bool,
        deserialize_i8,
        deserialize_i16,
        deserialize_i32,
        deserialize_i64,
        deserialize_i128,
        deserialize_u8,
        deserialize_u16,
        deserialize_u32,
        deserialize_u64,
        deserialize_u128,
        deserialize_f32,
        deserialize_f64,
        deserialize_char,
        deserialize_str,
        deserialize_bytes,
        deserialize_option,
        deserialize_unit,
        deserialize_identifier,
        deserialize_ignored_any
    );
    fn deserialize_string<V: Visitor<'de>>(self, visitor: V) -> Result<V::Value, D::Error> {
        self.deserialize_str(visitor) // Slice Postcard borrows before the visitor allocates.
    }
    fn deserialize_byte_buf<V: Visitor<'de>>(self, visitor: V) -> Result<V::Value, D::Error> {
        self.deserialize_bytes(visitor)
    }
    fn deserialize_seq<V: Visitor<'de>>(self, visitor: V) -> Result<V::Value, D::Error> {
        let _frame = self.budget.enter::<D::Error>(0)?;
        self.source.deserialize_seq(CheckedVisitor {
            visitor,
            budget: self.budget,
            dynamic: true,
        })
    }
    fn deserialize_map<V: Visitor<'de>>(self, visitor: V) -> Result<V::Value, D::Error> {
        let _frame = self.budget.enter::<D::Error>(0)?;
        self.source.deserialize_map(CheckedVisitor {
            visitor,
            budget: self.budget,
            dynamic: true,
        })
    }
    fn deserialize_tuple<V: Visitor<'de>>(
        self,
        len: usize,
        visitor: V,
    ) -> Result<V::Value, D::Error> {
        let _frame = self.budget.enter::<D::Error>(mem::size_of::<V::Value>())?;
        self.source.deserialize_tuple(
            len,
            CheckedVisitor {
                visitor,
                budget: self.budget,
                dynamic: false,
            },
        )
    }
    fn deserialize_tuple_struct<V: Visitor<'de>>(
        self,
        name: &'static str,
        len: usize,
        visitor: V,
    ) -> Result<V::Value, D::Error> {
        let _frame = self.budget.enter::<D::Error>(mem::size_of::<V::Value>())?;
        self.source.deserialize_tuple_struct(
            name,
            len,
            CheckedVisitor {
                visitor,
                budget: self.budget,
                dynamic: false,
            },
        )
    }
    fn deserialize_struct<V: Visitor<'de>>(
        self,
        name: &'static str,
        fields: &'static [&'static str],
        visitor: V,
    ) -> Result<V::Value, D::Error> {
        let _frame = self.budget.enter::<D::Error>(mem::size_of::<V::Value>())?;
        self.source.deserialize_struct(
            name,
            fields,
            CheckedVisitor {
                visitor,
                budget: self.budget,
                dynamic: false,
            },
        )
    }
    fn deserialize_enum<V: Visitor<'de>>(
        self,
        name: &'static str,
        variants: &'static [&'static str],
        visitor: V,
    ) -> Result<V::Value, D::Error> {
        let _frame = self.budget.enter::<D::Error>(mem::size_of::<V::Value>())?;
        // The pinned shape/workspace decoders name their wire enums here. Restrict
        // Ferrum checkpoint input before any variant payload is constructed;
        // independent vendor/public-value Serde keeps its broader variants.
        let kind = match name {
            "DeserializableTypedShape" => Some(enum_admission::Kind::Shape),
            "DeserializableWorkspaceData" => Some(enum_admission::Kind::ContactWorkspace),
            _ => None,
        };
        if let Some(kind) = kind {
            return self.source.deserialize_enum(
                name,
                variants,
                CheckedVisitor {
                    visitor: enum_admission::NativeEnumVisitor::new(visitor, variants, kind),
                    budget: self.budget,
                    dynamic: false,
                },
            );
        }
        self.source.deserialize_enum(
            name,
            variants,
            CheckedVisitor {
                visitor,
                budget: self.budget,
                dynamic: false,
            },
        )
    }
    fn deserialize_unit_struct<V: Visitor<'de>>(
        self,
        name: &'static str,
        visitor: V,
    ) -> Result<V::Value, D::Error> {
        let _frame = self.budget.enter::<D::Error>(0)?;
        self.source.deserialize_unit_struct(
            name,
            CheckedVisitor {
                visitor,
                budget: self.budget,
                dynamic: false,
            },
        )
    }
    fn deserialize_newtype_struct<V: Visitor<'de>>(
        self,
        name: &'static str,
        visitor: V,
    ) -> Result<V::Value, D::Error> {
        let _frame = self.budget.enter::<D::Error>(mem::size_of::<V::Value>())?;
        self.source.deserialize_newtype_struct(
            name,
            CheckedVisitor {
                visitor,
                budget: self.budget,
                dynamic: false,
            },
        )
    }
    fn is_human_readable(&self) -> bool {
        self.source.is_human_readable()
    }
}
macro_rules! visit_scalar {
    ($($method:ident($ty:ty)),*) => {$(
        fn $method<E: de::Error>(self, value: $ty) -> Result<V::Value, E> { self.visitor.$method(value) }
    )*};
}
impl<'de, V: Visitor<'de>> Visitor<'de> for CheckedVisitor<'_, V> {
    type Value = V::Value;
    fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.visitor.expecting(f)
    }
    visit_scalar!(
        visit_bool(bool),
        visit_i8(i8),
        visit_i16(i16),
        visit_i32(i32),
        visit_i64(i64),
        visit_i128(i128),
        visit_u8(u8),
        visit_u16(u16),
        visit_u32(u32),
        visit_u64(u64),
        visit_u128(u128),
        visit_f32(f32),
        visit_f64(f64),
        visit_char(char)
    );
    fn visit_str<E: de::Error>(self, value: &str) -> Result<V::Value, E> {
        self.budget.charge::<E>(value.len())?;
        self.visitor.visit_str(value)
    }
    fn visit_borrowed_str<E: de::Error>(self, value: &'de str) -> Result<V::Value, E> {
        self.budget.charge::<E>(value.len())?;
        self.visitor.visit_borrowed_str(value)
    }
    fn visit_string<E: de::Error>(self, value: String) -> Result<V::Value, E> {
        self.budget.charge::<E>(value.len())?;
        self.visitor.visit_string(value)
    }
    fn visit_bytes<E: de::Error>(self, value: &[u8]) -> Result<V::Value, E> {
        self.budget.charge::<E>(value.len())?;
        self.visitor.visit_bytes(value)
    }
    fn visit_borrowed_bytes<E: de::Error>(self, value: &'de [u8]) -> Result<V::Value, E> {
        self.budget.charge::<E>(value.len())?;
        self.visitor.visit_borrowed_bytes(value)
    }
    fn visit_byte_buf<E: de::Error>(self, value: Vec<u8>) -> Result<V::Value, E> {
        self.budget.charge::<E>(value.len())?;
        self.visitor.visit_byte_buf(value)
    }
    fn visit_none<E: de::Error>(self) -> Result<V::Value, E> {
        self.visitor.visit_none()
    }
    fn visit_unit<E: de::Error>(self) -> Result<V::Value, E> {
        self.visitor.visit_unit()
    }
    fn visit_some<D: de::Deserializer<'de>>(self, source: D) -> Result<V::Value, D::Error> {
        self.visitor.visit_some(Reader {
            source,
            budget: self.budget,
        })
    }
    fn visit_newtype_struct<D: de::Deserializer<'de>>(
        self,
        source: D,
    ) -> Result<V::Value, D::Error> {
        self.visitor.visit_newtype_struct(Reader {
            source,
            budget: self.budget,
        })
    }
    fn visit_seq<A: SeqAccess<'de>>(self, source: A) -> Result<V::Value, A::Error> {
        if self.dynamic
            && source
                .size_hint()
                .is_some_and(|n| n > self.budget.limits.collection)
        {
            return Err(self.budget.reject(Limit::Collection));
        }
        self.visitor.visit_seq(Sequence {
            source,
            budget: self.budget,
            dynamic: self.dynamic,
            index: 0,
        })
    }
    fn visit_map<A: MapAccess<'de>>(self, source: A) -> Result<V::Value, A::Error> {
        if source
            .size_hint()
            .is_some_and(|n| n > self.budget.limits.collection)
        {
            return Err(self.budget.reject(Limit::Collection));
        }
        self.visitor.visit_map(Mapping {
            source,
            budget: self.budget,
            keys: 0,
            values: 0,
        })
    }
    fn visit_enum<A: EnumAccess<'de>>(self, source: A) -> Result<V::Value, A::Error> {
        self.visitor.visit_enum(Enumeration {
            source,
            budget: self.budget,
        })
    }
}
struct Seed<'a, S> {
    seed: S,
    budget: &'a Budget,
    index: Option<&'a mut usize>,
}
impl<'de, S: DeserializeSeed<'de>> DeserializeSeed<'de> for Seed<'_, S> {
    type Value = S::Value;
    fn deserialize<D: de::Deserializer<'de>>(self, source: D) -> Result<S::Value, D::Error> {
        if let Some(index) = self.index {
            self.budget
                .element::<D::Error>(index, mem::size_of::<S::Value>())?;
        }
        self.seed.deserialize(Reader {
            source,
            budget: self.budget,
        })
    }
}
struct Sequence<'a, A> {
    source: A,
    budget: &'a Budget,
    dynamic: bool,
    index: usize,
}
impl<'de, A: SeqAccess<'de>> SeqAccess<'de> for Sequence<'_, A> {
    type Error = A::Error;
    fn next_element_seed<S: DeserializeSeed<'de>>(
        &mut self,
        seed: S,
    ) -> Result<Option<S::Value>, A::Error> {
        self.source.next_element_seed(Seed {
            seed,
            budget: self.budget,
            index: self.dynamic.then_some(&mut self.index),
        })
    }
    fn size_hint(&self) -> Option<usize> {
        if self.dynamic {
            None
        } else {
            self.source.size_hint()
        }
    }
}
struct Mapping<'a, A> {
    source: A,
    budget: &'a Budget,
    keys: usize,
    values: usize,
}
impl<'de, A: MapAccess<'de>> MapAccess<'de> for Mapping<'_, A> {
    type Error = A::Error;
    fn next_key_seed<S: DeserializeSeed<'de>>(
        &mut self,
        seed: S,
    ) -> Result<Option<S::Value>, A::Error> {
        self.source.next_key_seed(Seed {
            seed,
            budget: self.budget,
            index: Some(&mut self.keys),
        })
    }
    fn next_value_seed<S: DeserializeSeed<'de>>(&mut self, seed: S) -> Result<S::Value, A::Error> {
        self.source.next_value_seed(Seed {
            seed,
            budget: self.budget,
            index: Some(&mut self.values),
        })
    }
    fn size_hint(&self) -> Option<usize> {
        None
    }
}
struct Enumeration<'a, A> {
    source: A,
    budget: &'a Budget,
}
impl<'a, 'de, A: EnumAccess<'de>> EnumAccess<'de> for Enumeration<'a, A> {
    type Error = A::Error;
    type Variant = Variant<'a, A::Variant>;
    fn variant_seed<S: DeserializeSeed<'de>>(
        self,
        seed: S,
    ) -> Result<(S::Value, Self::Variant), A::Error> {
        let (value, source) = self.source.variant_seed(Seed {
            seed,
            budget: self.budget,
            index: None,
        })?;
        Ok((
            value,
            Variant {
                source,
                budget: self.budget,
            },
        ))
    }
}
struct Variant<'a, A> {
    source: A,
    budget: &'a Budget,
}

#[cfg(test)]
mod tests;
impl<'de, A: VariantAccess<'de>> VariantAccess<'de> for Variant<'_, A> {
    type Error = A::Error;
    fn unit_variant(self) -> Result<(), A::Error> {
        self.source.unit_variant()
    }
    fn newtype_variant_seed<S: DeserializeSeed<'de>>(self, seed: S) -> Result<S::Value, A::Error> {
        self.source.newtype_variant_seed(Seed {
            seed,
            budget: self.budget,
            index: None,
        })
    }
    fn tuple_variant<V: Visitor<'de>>(self, len: usize, visitor: V) -> Result<V::Value, A::Error> {
        let _frame = self.budget.enter::<A::Error>(mem::size_of::<V::Value>())?;
        self.source.tuple_variant(
            len,
            CheckedVisitor {
                visitor,
                budget: self.budget,
                dynamic: false,
            },
        )
    }
    fn struct_variant<V: Visitor<'de>>(
        self,
        fields: &'static [&'static str],
        visitor: V,
    ) -> Result<V::Value, A::Error> {
        let _frame = self.budget.enter::<A::Error>(mem::size_of::<V::Value>())?;
        self.source.struct_variant(
            fields,
            CheckedVisitor {
                visitor,
                budget: self.budget,
                dynamic: false,
            },
        )
    }
}
