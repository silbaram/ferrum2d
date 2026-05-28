export class FakeEngine {
  resolvedConfig?: number[];
  animationConfig?: number[];
  cameraConfig?: number[];
  audioConfig?: number[];
  wavesCleared = false;
  waves: number[][] = [];
  atlasFrames: number[][] = [];
  atlasAnimations: Array<{
    prefab: number;
    textureId: number;
    width: number;
    height: number;
    idleFps: number;
    idleFrames: number[];
    moveFps: number;
    moveFrames: number[];
  }> = [];
  prefabColliders: Array<[
    number,
    number,
    number,
    number,
    number,
    boolean,
    boolean,
    boolean,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ]> = [];
  circlePrefabColliders: Array<[number, number, number, number, boolean, boolean, boolean, number, number, number, number, number, number, number, number, number]> = [];
  capsulePrefabColliders: Array<[
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    boolean,
    boolean,
    boolean,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ]> = [];
  orientedBoxPrefabColliders: Array<[
    number,
    number,
    number,
    number,
    number,
    number,
    boolean,
    boolean,
    boolean,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ]> = [];
  convexPolygonPrefabColliders: Array<{
    prefab: number;
    vertices: number[];
    rotationRadians: number;
    offsetX: number;
    offsetY: number;
    enabled: boolean;
    trigger: boolean;
    hasMaterial: boolean;
    restitution: number;
    friction: number;
    surfaceVelocityX: number;
    surfaceVelocityY: number;
    density: number;
    contactBaumgarteBiasScale: number;
    maxContactBaumgarteBiasVelocityScale: number;
    contactPositionCorrectionScale: number;
    contactPositionCorrectionSlopScale: number;
  }> = [];
  tilemapCleared = false;
  tiles: number[][] = [];
  tileSlopes: number[][] = [];
  tileOneWayPlatforms: number[] = [];
  tileLayers: Array<[number, number, number, number, number, number, number, boolean, number[]]> = [];

  set_shooter_resolved_config(
    worldWidth: number,
    worldHeight: number,
    playerSpeed: number,
    enemySpeed: number,
    enemySpawnInterval: number,
    bulletSpeed: number,
    fireCooldown: number,
    bulletLifetime: number,
    playerWidth: number,
    playerHeight: number,
    enemyWidth: number,
    enemyHeight: number,
    bulletWidth: number,
    bulletHeight: number,
    playerAnimationFrames: number,
    playerAnimationFps: number,
    enemyAnimationFrames: number,
    enemyAnimationFps: number,
    bulletAnimationFrames: number,
    bulletAnimationFps: number,
    enemyBehavior: number,
    enemySpawnPattern: number,
    enemyHealth: number,
    bulletDamage: number,
    scoreReward: number,
    orbitRadius: number,
    orbitRadialBand: number,
  ): void {
    this.resolvedConfig = [
      worldWidth,
      worldHeight,
      playerSpeed,
      enemySpeed,
      enemySpawnInterval,
      bulletSpeed,
      fireCooldown,
      bulletLifetime,
      playerWidth,
      playerHeight,
      enemyWidth,
      enemyHeight,
      bulletWidth,
      bulletHeight,
      playerAnimationFrames,
      playerAnimationFps,
      enemyAnimationFrames,
      enemyAnimationFps,
      bulletAnimationFrames,
      bulletAnimationFps,
      enemyBehavior,
      enemySpawnPattern,
      enemyHealth,
      bulletDamage,
      scoreReward,
      orbitRadius,
      orbitRadialBand,
    ];
  }

  set_shooter_animations(
    playerColumns: number,
    playerRows: number,
    playerIdleRow: number,
    playerIdleFrames: number,
    playerIdleFps: number,
    playerMoveRow: number,
    playerMoveFrames: number,
    playerMoveFps: number,
    enemyColumns: number,
    enemyRows: number,
    enemyIdleRow: number,
    enemyIdleFrames: number,
    enemyIdleFps: number,
    enemyMoveRow: number,
    enemyMoveFrames: number,
    enemyMoveFps: number,
    bulletColumns: number,
    bulletRows: number,
    bulletIdleRow: number,
    bulletIdleFrames: number,
    bulletIdleFps: number,
    bulletMoveRow: number,
    bulletMoveFrames: number,
    bulletMoveFps: number,
  ): void {
    this.animationConfig = [
      playerColumns,
      playerRows,
      playerIdleRow,
      playerIdleFrames,
      playerIdleFps,
      playerMoveRow,
      playerMoveFrames,
      playerMoveFps,
      enemyColumns,
      enemyRows,
      enemyIdleRow,
      enemyIdleFrames,
      enemyIdleFps,
      enemyMoveRow,
      enemyMoveFrames,
      enemyMoveFps,
      bulletColumns,
      bulletRows,
      bulletIdleRow,
      bulletIdleFrames,
      bulletIdleFps,
      bulletMoveRow,
      bulletMoveFrames,
      bulletMoveFps,
    ];
  }

  set_shooter_camera_preset(
    preset: number,
    deadZoneWidth: number,
    deadZoneHeight: number,
    lookAheadDistance: number,
    shakeAmplitude: number,
    shakeFrequency: number,
  ): void {
    this.cameraConfig = [
      preset,
      deadZoneWidth,
      deadZoneHeight,
      lookAheadDistance,
      shakeAmplitude,
      shakeFrequency,
    ];
  }

  set_shooter_atlas_frame(
    prefab: number,
    textureId: number,
    width: number,
    height: number,
    u0: number,
    v0: number,
    u1: number,
    v1: number,
  ): void {
    this.atlasFrames.push([prefab, textureId, width, height, u0, v0, u1, v1]);
  }

  set_shooter_atlas_animation(
    prefab: number,
    textureId: number,
    width: number,
    height: number,
    idleFps: number,
    idleFrames: Float32Array,
    moveFps: number,
    moveFrames: Float32Array,
  ): void {
    this.atlasAnimations.push({
      prefab,
      textureId,
      width,
      height,
      idleFps,
      idleFrames: Array.from(idleFrames),
      moveFps,
      moveFrames: Array.from(moveFrames),
    });
  }

  set_shooter_prefab_collider(
    prefab: number,
    halfWidth: number,
    halfHeight: number,
    offsetX: number,
    offsetY: number,
    enabled: boolean,
    trigger: boolean,
    hasMaterial: boolean,
    restitution: number,
    friction: number,
    surfaceVelocityX: number,
    surfaceVelocityY: number,
    density: number,
    contactBaumgarteBiasScale: number,
    maxContactBaumgarteBiasVelocityScale: number,
    contactPositionCorrectionScale: number,
    contactPositionCorrectionSlopScale: number,
  ): boolean {
    this.prefabColliders.push([
      prefab,
      halfWidth,
      halfHeight,
      offsetX,
      offsetY,
      enabled,
      trigger,
      hasMaterial,
      restitution,
      friction,
      surfaceVelocityX,
      surfaceVelocityY,
      density,
      contactBaumgarteBiasScale,
      maxContactBaumgarteBiasVelocityScale,
      contactPositionCorrectionScale,
      contactPositionCorrectionSlopScale,
    ]);
    return true;
  }

  set_shooter_prefab_circle_collider(
    prefab: number,
    radius: number,
    offsetX: number,
    offsetY: number,
    enabled: boolean,
    trigger: boolean,
    hasMaterial: boolean,
    restitution: number,
    friction: number,
    surfaceVelocityX: number,
    surfaceVelocityY: number,
    density: number,
    contactBaumgarteBiasScale: number,
    maxContactBaumgarteBiasVelocityScale: number,
    contactPositionCorrectionScale: number,
    contactPositionCorrectionSlopScale: number,
  ): boolean {
    this.circlePrefabColliders.push([
      prefab,
      radius,
      offsetX,
      offsetY,
      enabled,
      trigger,
      hasMaterial,
      restitution,
      friction,
      surfaceVelocityX,
      surfaceVelocityY,
      density,
      contactBaumgarteBiasScale,
      maxContactBaumgarteBiasVelocityScale,
      contactPositionCorrectionScale,
      contactPositionCorrectionSlopScale,
    ]);
    return true;
  }

  set_shooter_prefab_capsule_collider(
    prefab: number,
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    radius: number,
    offsetX: number,
    offsetY: number,
    enabled: boolean,
    trigger: boolean,
    hasMaterial: boolean,
    restitution: number,
    friction: number,
    surfaceVelocityX: number,
    surfaceVelocityY: number,
    density: number,
    contactBaumgarteBiasScale: number,
    maxContactBaumgarteBiasVelocityScale: number,
    contactPositionCorrectionScale: number,
    contactPositionCorrectionSlopScale: number,
  ): boolean {
    this.capsulePrefabColliders.push([
      prefab,
      startX,
      startY,
      endX,
      endY,
      radius,
      offsetX,
      offsetY,
      enabled,
      trigger,
      hasMaterial,
      restitution,
      friction,
      surfaceVelocityX,
      surfaceVelocityY,
      density,
      contactBaumgarteBiasScale,
      maxContactBaumgarteBiasVelocityScale,
      contactPositionCorrectionScale,
      contactPositionCorrectionSlopScale,
    ]);
    return true;
  }

  set_shooter_prefab_oriented_box_collider(
    prefab: number,
    halfWidth: number,
    halfHeight: number,
    rotationRadians: number,
    offsetX: number,
    offsetY: number,
    enabled: boolean,
    trigger: boolean,
    hasMaterial: boolean,
    restitution: number,
    friction: number,
    surfaceVelocityX: number,
    surfaceVelocityY: number,
    density: number,
    contactBaumgarteBiasScale: number,
    maxContactBaumgarteBiasVelocityScale: number,
    contactPositionCorrectionScale: number,
    contactPositionCorrectionSlopScale: number,
  ): boolean {
    this.orientedBoxPrefabColliders.push([
      prefab,
      halfWidth,
      halfHeight,
      rotationRadians,
      offsetX,
      offsetY,
      enabled,
      trigger,
      hasMaterial,
      restitution,
      friction,
      surfaceVelocityX,
      surfaceVelocityY,
      density,
      contactBaumgarteBiasScale,
      maxContactBaumgarteBiasVelocityScale,
      contactPositionCorrectionScale,
      contactPositionCorrectionSlopScale,
    ]);
    return true;
  }

  set_shooter_prefab_convex_polygon_collider(
    prefab: number,
    vertices: Float32Array,
    rotationRadians: number,
    offsetX: number,
    offsetY: number,
    enabled: boolean,
    trigger: boolean,
    hasMaterial: boolean,
    restitution: number,
    friction: number,
    surfaceVelocityX: number,
    surfaceVelocityY: number,
    density: number,
    contactBaumgarteBiasScale: number,
    maxContactBaumgarteBiasVelocityScale: number,
    contactPositionCorrectionScale: number,
    contactPositionCorrectionSlopScale: number,
  ): boolean {
    this.convexPolygonPrefabColliders.push({
      prefab,
      vertices: Array.from(vertices),
      rotationRadians,
      offsetX,
      offsetY,
      enabled,
      trigger,
      hasMaterial,
      restitution,
      friction,
      surfaceVelocityX,
      surfaceVelocityY,
      density,
      contactBaumgarteBiasScale,
      maxContactBaumgarteBiasVelocityScale,
      contactPositionCorrectionScale,
      contactPositionCorrectionSlopScale,
    });
    return true;
  }

  clear_shooter_tilemap(): void {
    this.tilemapCleared = true;
    this.tiles = [];
    this.tileSlopes = [];
    this.tileOneWayPlatforms = [];
    this.tileLayers = [];
  }

  set_shooter_tile(
    tileId: number,
    textureId: number,
    u0: number,
    v0: number,
    u1: number,
    v1: number,
    r: number,
    g: number,
    b: number,
    a: number,
  ): void {
    this.tiles.push([tileId, textureId, u0, v0, u1, v1, r, g, b, a]);
  }

  set_shooter_tile_slope(
    tileId: number,
    localX0: number,
    localY0: number,
    localX1: number,
    localY1: number,
  ): void {
    this.tileSlopes.push([tileId, localX0, localY0, localX1, localY1]);
  }

  set_shooter_tile_one_way_platform(tileId: number): void {
    this.tileOneWayPlatforms.push(tileId);
  }

  set_shooter_tilemap_layer(
    index: number,
    columns: number,
    rows: number,
    tileWidth: number,
    tileHeight: number,
    originX: number,
    originY: number,
    collision: boolean,
    tiles: Uint32Array,
  ): void {
    this.tileLayers.push([index, columns, rows, tileWidth, tileHeight, originX, originY, collision, Array.from(tiles)]);
  }

  clear_shooter_waves(): void {
    this.wavesCleared = true;
    this.waves = [];
  }

  set_shooter_wave(
    index: number,
    duration: number,
    spawnInterval: number,
    enemyCount: number,
    enemySpeed: number,
    enemyBehavior: number,
    enemySpawnPattern: number,
    enemyHealth: number,
    scoreReward: number,
  ): void {
    this.waves.push([
      index,
      duration,
      spawnInterval,
      enemyCount,
      enemySpeed,
      enemyBehavior,
      enemySpawnPattern,
      enemyHealth,
      scoreReward,
    ]);
  }

  set_shooter_audio_policy(
    shootVolume: number,
    shootPitch: number,
    hitVolume: number,
    hitPitch: number,
    gameOverVolume: number,
    gameOverPitch: number,
  ): void {
    this.audioConfig = [shootVolume, shootPitch, hitVolume, hitPitch, gameOverVolume, gameOverPitch];
  }
}
