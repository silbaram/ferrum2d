// Ferrum2D file-only cold extension; see FERRUM-PATCHES.md.
//! Bounded deterministic Serde-event comparison stream, never persisted.
use super::{Budget, Error};
use alloc::vec::Vec;
use core::fmt;
use serde::{ser, Serialize};

pub(super) struct Encoder<'a> {
    budget: &'a mut Budget,
    bytes: Vec<u8>,
}
impl<'a> Encoder<'a> {
    pub(super) fn new(budget: &'a mut Budget) -> Self {
        Self {
            budget,
            bytes: Vec::new(),
        }
    }
    pub(super) fn finish(self) -> Vec<u8> {
        self.bytes
    }
    fn emit(&mut self, tag: u8, bytes: &[u8]) -> Result<(), Error> {
        self.budget.work(1)?;
        self.budget.append(&mut self.bytes, &[tag])?;
        self.budget.append(&mut self.bytes, bytes)
    }
    fn count(&mut self, tag: u8, len: usize) -> Result<(), Error> {
        self.budget.work(len)?;
        self.emit(tag, &(len as u64).to_le_bytes())
    }
    fn label(&mut self, tag: u8, text: &str) -> Result<(), Error> {
        self.count(tag, text.len())?;
        self.budget.append(&mut self.bytes, text.as_bytes())
    }
}

macro_rules! scalar {
    ($name:ident, $ty:ty, $tag:expr) => {
        fn $name(self, value: $ty) -> Result<(), Error> {
            self.emit($tag, &value.to_le_bytes())
        }
    };
}

impl<'a, 'b> ser::Serializer for &'a mut Encoder<'b> {
    type Ok = ();
    type Error = Error;
    type SerializeSeq = Self;
    type SerializeTuple = Self;
    type SerializeTupleStruct = Self;
    type SerializeTupleVariant = Self;
    type SerializeMap = Self;
    type SerializeStruct = Self;
    type SerializeStructVariant = Self;
    fn is_human_readable(&self) -> bool {
        false
    }
    fn serialize_bool(self, value: bool) -> Result<(), Error> {
        self.emit(1, &[u8::from(value)])
    }
    scalar!(serialize_i8, i8, 2);
    scalar!(serialize_i16, i16, 3);
    scalar!(serialize_i32, i32, 4);
    scalar!(serialize_i64, i64, 5);
    scalar!(serialize_i128, i128, 6);
    scalar!(serialize_u8, u8, 7);
    scalar!(serialize_u16, u16, 8);
    scalar!(serialize_u32, u32, 9);
    scalar!(serialize_u64, u64, 10);
    scalar!(serialize_u128, u128, 11);
    fn serialize_f32(self, value: f32) -> Result<(), Error> {
        self.emit(12, &value.to_bits().to_le_bytes())
    }
    fn serialize_f64(self, value: f64) -> Result<(), Error> {
        self.emit(13, &value.to_bits().to_le_bytes())
    }
    fn serialize_char(self, value: char) -> Result<(), Error> {
        self.emit(14, &(value as u32).to_le_bytes())
    }
    fn serialize_str(self, value: &str) -> Result<(), Error> {
        self.label(15, value)
    }
    fn serialize_bytes(self, value: &[u8]) -> Result<(), Error> {
        self.count(16, value.len())?;
        self.budget.append(&mut self.bytes, value)
    }
    fn serialize_none(self) -> Result<(), Error> {
        self.emit(17, &[])
    }
    fn serialize_some<T: ?Sized + Serialize>(self, value: &T) -> Result<(), Error> {
        self.emit(18, &[])?;
        value.serialize(self)
    }
    fn serialize_unit(self) -> Result<(), Error> {
        self.emit(19, &[])
    }
    fn serialize_unit_struct(self, name: &'static str) -> Result<(), Error> {
        self.label(20, name)
    }
    fn serialize_unit_variant(
        self,
        name: &'static str,
        index: u32,
        variant: &'static str,
    ) -> Result<(), Error> {
        self.label(21, name)?;
        self.emit(9, &index.to_le_bytes())?;
        self.label(22, variant)
    }
    fn serialize_newtype_struct<T: ?Sized + Serialize>(
        self,
        name: &'static str,
        value: &T,
    ) -> Result<(), Error> {
        self.label(23, name)?;
        value.serialize(self)
    }
    fn serialize_newtype_variant<T: ?Sized + Serialize>(
        self,
        name: &'static str,
        index: u32,
        variant: &'static str,
        value: &T,
    ) -> Result<(), Error> {
        self.label(24, name)?;
        self.emit(9, &index.to_le_bytes())?;
        self.label(22, variant)?;
        value.serialize(self)
    }
    fn serialize_seq(self, len: Option<usize>) -> Result<Self, Error> {
        self.count(25, len.ok_or(Error::Encoding)?)?;
        Ok(self)
    }
    fn serialize_tuple(self, len: usize) -> Result<Self, Error> {
        self.count(26, len)?;
        Ok(self)
    }
    fn serialize_tuple_struct(self, name: &'static str, len: usize) -> Result<Self, Error> {
        self.label(27, name)?;
        self.count(26, len)?;
        Ok(self)
    }
    fn serialize_tuple_variant(
        self,
        name: &'static str,
        index: u32,
        variant: &'static str,
        len: usize,
    ) -> Result<Self, Error> {
        self.label(28, name)?;
        self.emit(9, &index.to_le_bytes())?;
        self.label(22, variant)?;
        self.count(26, len)?;
        Ok(self)
    }
    fn serialize_map(self, len: Option<usize>) -> Result<Self, Error> {
        let len = len.ok_or(Error::Encoding)?;
        self.budget
            .work(len.checked_mul(2).ok_or(Error::WorkLimit)?)?;
        self.count(29, len)?;
        Ok(self)
    }
    fn serialize_struct(self, name: &'static str, len: usize) -> Result<Self, Error> {
        self.label(30, name)?;
        self.count(26, len)?;
        Ok(self)
    }
    fn serialize_struct_variant(
        self,
        name: &'static str,
        index: u32,
        variant: &'static str,
        len: usize,
    ) -> Result<Self, Error> {
        self.label(31, name)?;
        self.emit(9, &index.to_le_bytes())?;
        self.label(22, variant)?;
        self.count(26, len)?;
        Ok(self)
    }
    fn collect_str<T: ?Sized + fmt::Display>(self, _: &T) -> Result<(), Error> {
        Err(Error::Encoding)
    }
}

macro_rules! sequence {
    ($trait:ident, $method:ident) => {
        impl ser::$trait for &mut Encoder<'_> {
            type Ok = ();
            type Error = Error;
            fn $method<T: ?Sized + Serialize>(&mut self, value: &T) -> Result<(), Error> {
                value.serialize(&mut **self)
            }
            fn end(self) -> Result<(), Error> {
                self.emit(255, &[])
            }
        }
    };
}
sequence!(SerializeSeq, serialize_element);
sequence!(SerializeTuple, serialize_element);
sequence!(SerializeTupleStruct, serialize_field);
sequence!(SerializeTupleVariant, serialize_field);

impl ser::SerializeMap for &mut Encoder<'_> {
    type Ok = ();
    type Error = Error;
    fn serialize_key<T: ?Sized + Serialize>(&mut self, value: &T) -> Result<(), Error> {
        self.emit(32, &[])?;
        value.serialize(&mut **self)
    }
    fn serialize_value<T: ?Sized + Serialize>(&mut self, value: &T) -> Result<(), Error> {
        self.emit(33, &[])?;
        value.serialize(&mut **self)
    }
    fn end(self) -> Result<(), Error> {
        self.emit(255, &[])
    }
}
macro_rules! structure {
    ($trait:ident) => {
        impl ser::$trait for &mut Encoder<'_> {
            type Ok = ();
            type Error = Error;
            fn serialize_field<T: ?Sized + Serialize>(
                &mut self,
                key: &'static str,
                value: &T,
            ) -> Result<(), Error> {
                self.label(34, key)?;
                value.serialize(&mut **self)
            }
            fn end(self) -> Result<(), Error> {
                self.emit(255, &[])
            }
        }
    };
}
structure!(SerializeStruct);
structure!(SerializeStructVariant);
