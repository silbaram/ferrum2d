use super::*;

fn telemetry_time(engine: &Engine) -> f64 {
    unsafe { *engine.frame_telemetry_ptr() }
}

#[test]
fn update_frame_can_skip_unread_output_buffers() {
    let mut engine = Engine::new();

    engine.update_frame(0.016, true, true, true);
    assert!(engine.render_command_len() > 0);
    let written_time = telemetry_time(&engine);
    assert_eq!(written_time, engine.time());

    engine.update_frame(0.5, false, false, false);

    assert!(engine.time() > written_time);
    assert_eq!(engine.render_command_len(), 0);
    assert_eq!(engine.physics_debug_line_len(), 0);
    assert_eq!(telemetry_time(&engine), written_time);

    engine.update_frame(0.0, true, true, false);

    assert!(engine.render_command_len() > 0);
    assert_eq!(telemetry_time(&engine), engine.time());
}
