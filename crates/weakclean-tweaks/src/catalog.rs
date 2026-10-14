//! แคตตาล็อก tweak (อ่านจาก data/tweaks/catalog.toml ที่ฝังมากับตัวโปรแกรม)

use crate::sys::{Hive, RegData, StartType};
use serde::Deserialize;

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Risk {
    Safe,
    Recommended,
    Expert,
}

impl Risk {
    pub fn as_str(self) -> &'static str {
        match self {
            Risk::Safe => "safe",
            Risk::Recommended => "recommended",
            Risk::Expert => "expert",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Op {
    Registry { hive: Hive, path: String, name: String, value: RegData },
    Service { name: String, start: StartType, stop: bool },
}

impl Op {
    pub fn needs_admin(&self) -> bool {
        match self {
            Op::Registry { hive, .. } => *hive == Hive::HKLM,
            Op::Service { .. } => true,
        }
    }
}

#[derive(Debug, Clone)]
pub struct TweakDef {
    pub id: String,
    pub category: String,
    pub risk: Risk,
    pub reboot: bool,
    pub profiles: Vec<String>,
    pub name_th: String,
    pub name_en: String,
    pub desc_th: String,
    pub desc_en: String,
    pub ops: Vec<Op>,
}

impl TweakDef {
    pub fn requires_admin(&self) -> bool {
        self.ops.iter().any(Op::needs_admin)
    }
}

#[derive(Deserialize)]
struct RawOp {
    #[serde(rename = "type")]
    ty: String,
    hive: Option<Hive>,
    path: Option<String>,
    name: String,
    kind: Option<String>,
    value: Option<toml::Value>,
    start: Option<StartType>,
    #[serde(default)]
    stop: bool,
}

#[derive(Deserialize)]
struct RawTweak {
    id: String,
    category: String,
    risk: Risk,
    #[serde(default)]
    reboot: bool,
    #[serde(default)]
    profiles: Vec<String>,
    name_th: String,
    name_en: String,
    desc_th: String,
    desc_en: String,
    ops: Vec<RawOp>,
}

#[derive(Deserialize)]
struct RawCatalog {
    tweak: Vec<RawTweak>,
}

fn convert(op: RawOp, tweak: &str) -> Result<Op, String> {
    let err = |m: &str| format!("tweak {tweak}: {m}");
    match op.ty.as_str() {
        "registry" => {
            let value = match (op.kind.as_deref(), op.value) {
                (Some("dword"), Some(toml::Value::Integer(i))) => RegData::Dword(u32::try_from(i).map_err(|_| err("dword out of range"))?),
                (Some("sz"), Some(toml::Value::String(s))) => RegData::Sz(s),
                _ => return Err(err("registry op needs kind = dword|sz and a matching value")),
            };
            Ok(Op::Registry { hive: op.hive.ok_or_else(|| err("missing hive"))?, path: op.path.ok_or_else(|| err("missing path"))?, name: op.name, value })
        }
        "service" => Ok(Op::Service { name: op.name, start: op.start.ok_or_else(|| err("missing start"))?, stop: op.stop }),
        other => Err(err(&format!("unknown op type {other}"))),
    }
}

pub fn parse(text: &str) -> Result<Vec<TweakDef>, String> {
    let raw: RawCatalog = toml::from_str(text).map_err(|e| e.to_string())?;
    raw.tweak
        .into_iter()
        .map(|t| {
            let ops = t.ops.into_iter().map(|o| convert(o, &t.id)).collect::<Result<Vec<_>, _>>()?;
            Ok(TweakDef { id: t.id, category: t.category, risk: t.risk, reboot: t.reboot, profiles: t.profiles, name_th: t.name_th, name_en: t.name_en, desc_th: t.desc_th, desc_en: t.desc_en, ops })
        })
        .collect()
}

/// tweak ทั้งหมดที่ติดมากับโปรแกรม
pub fn builtin() -> Vec<TweakDef> {
    parse(include_str!("../../../data/tweaks/catalog.toml")).expect("data/tweaks/catalog.toml must be valid")
}
