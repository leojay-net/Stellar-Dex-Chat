//! Fails when an event struct in `lib.rs` is missing from `docs/EVENTS.md`.

#[test]
fn every_event_struct_is_documented() {
    let src = include_str!("lib.rs");
    let doc = include_str!("../docs/EVENTS.md");
    let mut lines = src.lines();
    while let Some(line) = lines.next() {
        if line.trim() != "#[contractevent]" {
            continue;
        }
        for next in lines.by_ref() {
            if let Some(rest) = next.trim().strip_prefix("pub struct ") {
                let name = rest
                    .split(|c: char| !c.is_alphanumeric() && c != '_')
                    .next()
                    .unwrap();
                assert!(doc.contains(name), "event missing from docs/EVENTS.md");
                break;
            }
        }
    }
}
