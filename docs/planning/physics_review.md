# Ferrum2D 게임 물리 엔진 9차 심층 검토 및 개선 보고서 (Physics Engine Review)

이 보고서는 Ferrum2D 게임 물리 엔진의 코어 레이어(`crates/ferrum-core/src/physics/`) 및 관련 모듈들을 심층 분석하여, **수학적/기하학적 오류(Bugs)**와 **실시간 게임 환경에서의 성능/안정성을 저해하는 개선 요구사항(Improvements)**, 그리고 차세대 에이전트 퍼스트 엔진으로의 진화를 위한 **고도화 로드맵(Advanced Features)**을 정리한 문서입니다.

---

## 1. 틀린 부분 및 수학적/논리적 오류 (Bugs & Structural Errors)

### 1.1. Distance / Spring / Rope Joint의 회전 관성 누락 및 앵커 좌표 부재
* **대상 파일**:
  - `crates/ferrum-core/src/physics/joints/distance_joint.rs`
  - `crates/ferrum-core/src/physics/joints/spring_joint.rs`
  - `crates/ferrum-core/src/physics/joints/rope_joint.rs`
  - `crates/ferrum-core/src/physics/body_impulses.rs#L27-L48`
* **수학적 분석 및 증명**:
  2D 평면 상에서 두 강체 $A, B$의 질량 중심을 $\mathbf{x}_A, \mathbf{x}_B$, 각 강체의 로컬 앵커 오프셋을 $\mathbf{l}_A, \mathbf{l}_B$라 할 때, 월드 공간 상의 앵커 위치는 다음과 같습니다.
  $$\mathbf{p}_A = \mathbf{x}_A + R_A \mathbf{l}_A, \quad \mathbf{p}_B = \mathbf{x}_B + R_B \mathbf{l}_B$$
  두 앵커 사이의 변위 벡터를 $\mathbf{d} = \mathbf{p}_B - \mathbf{p}_A$, 거리를 $L = \|\mathbf{d}\|$, 단위 방향 벡터를 $\mathbf{n} = \mathbf{d} / L$이라 할 때, 거리 제약 조건식 $C$는 다음과 같이 정의됩니다.
  $$C = \|\mathbf{d}\| - L_{rest} = 0$$
  이 제약식의 시간에 대한 도함수(시간 변화율)를 구하면 속도 관계식과 야코비안(Jacobian) $J$를 도출할 수 있습니다.
  $$\dot{C} = \mathbf{n} \cdot (\dot{\mathbf{p}}_B - \dot{\mathbf{p}}_A) = \mathbf{n} \cdot \left( \mathbf{v}_B + \omega_B \times \mathbf{r}_B - (\mathbf{v}_A + \omega_A \times \mathbf{r}_A) \right) = 0$$
  여기서 $\mathbf{r}_A = \mathbf{p}_A - \mathbf{x}_A$, $\mathbf{r}_B = \mathbf{p}_B - \mathbf{x}_B$는 질량 중심에서 앵커 포인트까지의 외적 반지름 벡터입니다. 2D 평면 외적 성질($\omega \times \mathbf{r} = \omega [-r_y, r_x]^T$)을 대입하여 야코비안 $J$를 행렬 형태로 분해하면 다음과 같습니다.
  $$J = \begin{bmatrix} -\mathbf{n}^T & -(\mathbf{r}_A \times \mathbf{n}) & \mathbf{n}^T & (\mathbf{r}_B \times \mathbf{n}) \end{bmatrix}$$
  제약식 해소에 필요한 유효 질량(Effective Mass)의 역수인 분모 항 $K = J M^{-1} J^T$는 다음과 같이 유도됩니다.
  $$K = m_A^{-1} + m_B^{-1} + I_A^{-1}(\mathbf{r}_A \times \mathbf{n})^2 + I_B^{-1}(\mathbf{r}_B \times \mathbf{n})^2$$
  여기서 2D 외적 스칼라 값은 $(\mathbf{r} \times \mathbf{n}) = r_x n_y - r_y n_x$입니다.

  **현재 코드의 결함**:
  현재 구현된 세 조인트는 $\mathbf{r}_A, \mathbf{r}_B$ 오프셋을 아예 받지 않고 무조건 중심점 연결로만 설계되었습니다. 이로 인해 유효 질량 분모가 회전 관성 항($I^{-1}$)이 완전히 배제된 채 $K = m_A^{-1} + m_B^{-1}$로만 계산되며, 충격량 전달 시에도 `crates/ferrum-core/src/physics/body_impulses.rs`의 `apply_contact_impulse` 함수만을 사용하여 강체의 선속도만 바꿀 뿐 **각속도($\omega$)를 전혀 갱신하지 않습니다**.
* **영향**: 조인트로 묶인 두 물체가 회전하려고 할 때 중심축 기준의 회전력(토크)이 물리적으로 전달되지 않습니다. 강체들이 매달려 회전하는 대신 파티클처럼 무게 중심 방향으로만 강제 이동하여 비현실적이고 딱딱한 왜곡 거동을 보입니다.

### 1.2. Weld Joint (용접 조인트) 위치 보정 시 각도 보정 누락으로 인한 Jitter 메커니즘
* **대상 파일**: `crates/ferrum-core/src/physics/joints/weld_joint.rs#L168-L220`
* **문제점**:
  용접 조인트는 두 바디 간의 상대 선형 변위와 각도 차이를 모두 0으로 고정(자유도 0)해야 합니다. 현재 구현은 `PrismaticJoint`로 이를 우회하여 해결하려 하지만, 앵커 갭을 보정하는 위치 제약 해결사인 `solve_weld_joint_anchor_position_constraint`와 `apply_weld_joint_anchor_position_correction`는 다음과 같이 심각하게 축소된 근사를 사용합니다.
  ```rust
  let denominator = context.inverse_mass_a + context.inverse_mass_b;
  let impulse = Velocity {
      vx: -error.vx * stiffness / denominator,
      vy: -error.vy * stiffness / denominator,
  };
  ```
  이 식은 각도 변위에 의한 앵커 교정 모멘트를 완전히 배제하고, 단순히 선형 질량 합으로 나눈 오차 만큼 강체를 평행 이동시킵니다.
* **Jitter 발생 메커니즘**:
  1. 두 강체가 회전하여 용접 지점(앵커)에 갭(오차)이 발생합니다.
  2. 위치 제약 해결사는 각도를 돌리지 않고, 오직 강체의 중심 좌표를 평행 이동해 앵커 갭을 강제로 맞춥니다.
  3. 평행 이동으로 앵커를 맞춘 직후, 강체의 중심이 정렬되지 않은 채 회전각만 원래대로 유지되므로 다음 물리 틱에서 회전 제약 및 속도 해결사가 강체를 다시 원래 각도로 정렬하려고 강체를 회전시킵니다.
  4. 강체가 회전하면서 앵커 갭이 다시 벌어지고, 위치 해결사는 이를 해결하기 위해 다시 강체를 평행 이동시킵니다.
  5. 이 모순된 선형 보정과 회전 정렬의 순환으로 인해 제약 조건이 한 프레임 내에 수렴하지 못하고 고주파 진동(Jitter) 현상이 발생하여 관절 부위가 덜덜 떨리게 됩니다.
* **개선안**: `apply_prismatic_joint_anchor_position_correction`처럼 앵커 거리 오차 수정 시, 질량 역수 뿐 아니라 회전 관성 역수와 외적 반지름 성분을 포함하여 **위치 이동과 각도 회전을 동시에 유도**해야 합니다.

### 1.3. Gear Joint (기어 조인트) 각도 오차 누적 시 수치 폭발 (Angle Wrap-around 누락)
* **대상 파일**: `crates/ferrum-core/src/physics/joints/gear_joint.rs#L135`
* **문제점**:
  기어 조인트의 각도 제약 조건식은 $C = \theta_B + r \theta_A - \theta_{ref} = 0$ 입니다. 기어 조인트의 컨텍스트 빌더는 다음과 같이 에러를 계산합니다.
  ```rust
  let error = rotation_b.radians + ratio * rotation_a.radians - reference_angle;
  ```
  이 계산 과정에서 각도 차이의 주기성($2\pi$ 라디안)에 따른 정규화(`normalize_angle_radians`)가 누락되어 있습니다.
* **물리 폭발(Explosion) 기전**:
  기어가 정방향 혹은 역방향으로 계속 회전하여 한 바퀴($2\pi$) 임계점을 통과할 때, 또는 강체의 Rotation2D 값이 타 시스템에 의해 $[-\pi, \pi]$ 범위로 강제 감싸기(wrapping) 될 때 에러 각도가 급격하게 튀게 됩니다.
  예를 들어, $\theta_B$가 $\pi - \epsilon$에서 $\pi + \epsilon$으로 회전하면서 $[-\pi, \pi]$ 범위에 의해 $-\pi + \epsilon$으로 리셋되는 순간, `error` 값은 한 프레임(1 step)만에 갑자기 $2\pi$ 만큼의 불연속적인 스파이크(Step jump)를 발생시킵니다.
  제약 조건 해결사는 이 거대하게 감지된 오차 $2\pi$를 해소하기 위해 극단적으로 큰 속도 교정 충격량($\Delta \lambda = -error / K$)을 강체에 인가합니다. 이로 인해 강체의 각속도가 무한대에 가깝게 치솟고, 연쇄적으로 위치 보정 단계에서 강체들이 우주로 날아가는 수치 폭발(Numerical Explosion)이 발생합니다.
* **개선안**: 에러 계산 직후 반드시 정규화 처리를 해줍니다.
  ```rust
  let error = normalize_angle_radians(rotation_b.radians + ratio * rotation_a.radians - reference_angle);
  ```

### 1.4. Revolute Joint (회전 조인트) 회전 제한 범위의 180도 축소 결함
* **대상 파일**:
  - `crates/ferrum-core/src/physics/joints/limits.rs#L24-L36`
  - `crates/ferrum-core/src/physics/joints/revolute_joint.rs#L376`
* **문제점**:
  `revolute_joint_angle_limits` 함수에서 사용자가 지정한 제한 범위의 하한/상한 각도를 정규화합니다.
  ```rust
  let lower_angle = normalize_angle_radians(joint.lower_angle);
  let upper_angle = normalize_angle_radians(joint.upper_angle);
  ```
  이로 인해 제한 각도가 무조건 $[-\pi, \pi]$ (즉 $-180^\circ \sim +180^\circ$) 범위로 감싸집니다. 만약 게임 개발자가 여러 바퀴 회전이 가능한 태엽이나 와이어 릴 같은 객체를 구현하기 위해 회전 범위를 $-360^\circ \sim +360^\circ$ ($-2\pi \sim 2\pi$)로 크게 주더라도, 노멀라이징에 의해 두 값이 모두 $0$으로 치환되거나 범위가 심각하게 왜곡되어 뒤집힙니다.
* **영향**: 180도 이상의 큰 각도 제한 구현이 불가능해지며, 180도를 넘어서는 순간 조인트가 리미트에 걸려 튕기거나 비정상적으로 멈추는 물리적 제한이 발생합니다.
* **개선안**: 제한 설정 각도를 단순 정규화하지 않고, 프레임 단위의 상대 회전 각도 변위 $\Delta \theta$를 누적하여 연속 각도(Continuous Angle)로 한계를 판별하는 누적각 추적 메커니즘을 도입해야 합니다.

### 1.5. CCD 임팩트 해소 시 delta_seconds = 1.0 하드코딩 오류
* **대상 파일**: `crates/ferrum-core/src/physics/solver.rs#L202-L213` (호출부: `crates/ferrum-core/src/physics/ccd.rs#L586-L608`)
* **문제점**:
  CCD 터치 순간의 속도 충격량을 푸는 `solve_ccd_velocity_contact`에서 `solve_velocity_contact_constraint` 함수를 호출할 때 마지막 매개변수인 `delta_seconds`에 `1.0`을 리터럴 상수로 강제 전달합니다.
  ```rust
  pub(super) fn solve_ccd_velocity_contact(..., config: RigidBodyStepConfig) -> bool {
      let mut constraint = RigidContactConstraint::new(pair, collider_pair, point, normal, 0.0, 0.0, 0.0);
      solve_velocity_contact_constraint(world, &mut constraint, config, 1.0).applied_impulse
  }
  ```
  이로 인해 바이어스 속도(Baumgarte bias) 연산식 내부에서 실제 물리 프레임 시간 $\Delta t$ 대신 $1.0$초가 곱해져 침투 복원력이 극도로 약화됩니다. CCD 충돌 순간에 침투가 이미 발생해 있는 경우 복원력이 실시간 프레임 시간 단위로 작동하지 않아 물체가 파묻히거나 뚫고 지나가는 정합성 결함이 발생합니다.

### 1.6. 미세 지속 외력에 의한 영구 비수면(Failure to Sleep under Persistent Micro-forces) 결함
* **대상 파일**:
  - `crates/ferrum-core/src/physics/sleep.rs#L167-L174`
  - `crates/ferrum-core/src/physics/rigid_body_step/integration.rs#L43-L47`
* **문제점**:
  강체의 Sleep 깨어남 판단부에서 단순히 축적된 힘/토크 및 충격량이 존재하는지 여부(`rigid_body_has_pending_wake_input(body)`)만을 기준으로 판단합니다. 마찰력/저항력이 외부에서 가해지는 힘을 상쇄하여 강체가 임계치 이하의 속도로 유지되는 미세한 지속 외력(예: 바람, 약한 중력 기어, 마모 감속 등)이 가해지면, 강체는 수면에 들어갔다가 1프레임만에 외력 감지로 즉시 다시 깨어납니다.
* **영향**: 깨어날 때 수면 유예 타이머(`sleep_timer_seconds`)가 $0.0$으로 리셋되므로, 해당 물체는 마찰로 정지해 있음에도 영원히 다시 자지 못하고 활성 상태(Active)에 묶여 CPU 시뮬레이션 예산을 지속적으로 낭비시킵니다.
* **개선안**: 인가된 힘의 크기가 일정 임계 수준(Threshold force) 이상일 때만 깨어나도록 하거나, 외부에서 강제 `wake_up()` API를 호출하는 방식으로 격리시켜야 합니다.

### 1.7. 수학적 정의 명칭과 조건식의 불일치 버그
* **대상 파일**: `crates/ferrum-core/src/physics/math.rs#L88-L94`
* **공식**:
  ```rust
  pub(super) fn sanitize_non_negative(value: f32) -> f32 {
      if value.is_finite() && value > 0.0 {
          value
      } else {
          0.0
      }
  }
  ```
* **문제점**:
  함수 이름이 `sanitize_non_negative`(음이 아닌 수 정화)임에도 불구하고, 실제 논리 연산 조건식은 `value > 0.0`으로 되어 있어 양수(Positive)만 정화 대상으로 처리하고 있습니다. 이로 인해 입력 값이 정확히 `0.0`일 때 조건이 거짓이 되어 `else` 분기로 이탈해 불필요하게 `0.0`을 다시 재할당합니다.
* **영향**: 성능 영향은 작으나 수식의 수학적 명명과 실제 부등식 조건의 괴리로 인해 정적 코드 검토 및 리팩토링 시 잠재적 논리 혼동을 줍니다.
* **개선안**: 부등식을 `value >= 0.0`으로 고치는 것이 수학적 명명에 일치합니다.

### 1.8. HD2D Bridge 관통 감지에서의 이산 보간 터널링(Tunneling) 결함
* **대상 파일**: `crates/ferrum-core/src/physics/hd2d_kinematic.rs#L274-L297`
* **문제점**:
  다리 밑을 안전하게 관통하는 2.5D 캐릭터 거동 판단 시, 시작 위치와 끝 위치의 직선 사이를 5개의 고정 가중치($t \in [0.0, 0.25, 0.5, 0.75, 1.0]$)로 보간한 샘플 지점들만 탐색합니다.
* **영향**: 캐릭터가 한 프레임에 빠르게 이동하여 다리 타일 크기를 건너뛰는 고속 프레임 이동이 발생할 경우, 다리 아래를 지나갔다는 판정을 터널링(관통 스킵)해 버립니다. 결국 캐릭터가 다리 기둥에 막혀 정지하거나, 다리 상단으로 강제 스냅(솟구침)되는 기하학적 왜곡 오류를 초래합니다.
* **개선안**: 고정 수 샘플링을 지양하고 선분 교차(Line intersection) 알고리즘이나 동적 레이캐스트 그리드 스캔을 연계해야 합니다.

### 1.9. KCC 점프 상승 중 턱(Step Offset) 오르기 차단 결함
* **대상 파일**: `crates/ferrum-core/src/physics/platformer_controller/step_offset.rs#L30-L37`
* **문제점**:
  계단 오르기를 시도하는 조건식 `should_attempt`에서 수직 하강 또는 수평 이동 중임을 판정하기 위해 `displacement.vy >= -KINEMATIC_EPSILON`을 필수로 요구합니다.
* **영향**: 캐릭터가 점프 상승(vy < -KINEMATIC_EPSILON) 중일 때는 턱 디딤 처리가 차단되어, 벽면의 작은 턱 부분에 닿았을 때 부드럽게 올라서지 못하고 걸려서 상승이 멈춥니다. 이후 점프 최고점에 도달해 vy가 양수(낙하)로 전송되기 시작하는 1프레임에 갑자기 계단 오르기가 발동해 위로 툭 튀어 오르는 시각적 Jitter를 유발합니다.
* **개선안**: 점프 상승 중에도 계단 오르기를 명확히 허용하되, 천장 충돌 조건과의 예외 정합성만 유도해야 합니다.

### 1.10. Baumgarte Bias 접근 중 스킵으로 인한 초기 파묻힘 및 벽 뚫림 현상
* **대상 파일**: `crates/ferrum-core/src/physics/solver/baumgarte.rs#L40`
* **문제점**:
  `contact_baumgarte_bias_velocity` 함수 내부의 조기 반환 조건식 중 상대 속도 검사 부등식이 `velocity_along_normal < -CONTACT_IMPULSE_EPSILON`일 때 `0.0`을 반환하도록 되어 있습니다. 상대 속도가 음수(즉, 두 물체가 충돌하여 안쪽으로 파고드는 중)일 때 Baumgarte Bias 복원력을 완전히 무시(스킵)합니다.
* **영향**:
  충돌 초기 단계에서 복원력(Push-out)이 전혀 작동하지 않아 강체가 벽 깊숙이 파묻히게 됩니다. 이후 마찰 및 솔버 속도 단계에 의해 상대 속도가 거의 0에 수렴하여 `velocity_along_normal >= -CONTACT_IMPULSE_EPSILON`이 된 시점에서야 복원력이 갑자기 대규모로 개입하게 되므로, 물체가 벽 밖으로 비정상적으로 강하게 튕겨 나가거나 심한 떨림(Jitter)을 유발하고, 심지어 얇은 벽을 관통하여 뚫고 지나가는 터널링 현상을 빚습니다.
* **개선안**:
  서로 멀어지는 상대 속도일 때 복원 속도를 무시하도록 조건을 `velocity_along_normal > CONTACT_IMPULSE_EPSILON`로 수정하여 접근 중인 상태에서는 복원력이 정상적으로 누적되도록 수정해야 합니다.

### 1.11. KCC 경사면 이동 시 수직 스냅 편향으로 인한 이동 속도 증폭 및 기하학적 왜곡
* **대상 파일**: `crates/ferrum-core/src/physics/platformer_controller/slope_ground.rs#L71-L82`
* **문제점**:
  `move_with_optional_slope_snap` 함수에서 수평 이동(`movement.end`)을 먼저 완료한 캐릭터 위치에서 수직 스냅(빗변 이동 보정)만 진행합니다:
  ```rust
  let snap_movement = move_and_slide_internal(
      world,
      tilemap,
      entity,
      Velocity {
          vx: 0.0,
          vy: hit.vertical_delta,
      },
      ...
  );
  ```
  이 수직 스냅은 경사면 빗변 방향으로의 속도 투영(Projection) 및 변위 보정이 결여되어 단순히 수평 이동 거리를 평지와 동일하게 둔 채 수직 위치만 맞춥니다.
* **영향**:
  경사가 가파를수록 실제 빗변을 타고 기어오를 때의 삼각비에 따라 평지 속도 대비 물리적 선속도($\sqrt{\Delta x^2 + \Delta y^2}$)가 강제로 증폭되는 왜곡을 초래합니다. 결과적으로 평지보다 가파른 경사로를 올라갈 때 실제 속도가 더 빨라지는 기하학적 모순이 발생합니다.
* **개선안**:
  경사 각도를 인지하여 수평 입력 속도 벡터를 경사 접선 벡터(Slope Tangent Vector)로 투영한 빗변 변위를 계산하여 `move_and_slide_internal`에 일괄 반영하도록 변경해야 합니다.

---

## 2. 게임 물리 엔진으로서 개선해야 하는 부분 (Real-time Performance & Game Stability)

### 2.1. 동일 서브스텝 내 충돌 매니폴드(Collision Manifold) 3중 중복 빌드 병목
* **대상 파일**:
  - `crates/ferrum-core/src/physics/sleep.rs`
  - `crates/ferrum-core/src/physics/rigid_body_step.rs`
* **문제점**:
  단 1회의 물리 서브스텝(`step_rigid_bodies_once`) 루프 동안, 물리 엔진 내에서 CPU 점유율이 가장 높은 **충돌 매니폴드 구축 연산(`CollisionSystem::build_rigid_collider_manifolds_into`)이 캐싱 없이 무려 3회나 독립적으로 중복 실행**됩니다.
  1. **수면 아일랜드 해제 단계**: `wake_sleeping_rigid_body_islands` 내부의 아일랜드 그래프 구성 시 실행.
  2. **물리 제약조건 빌드 단계**: `prepare_rigid_body_constraints`에서 충격량 연산용 제약조건을 만들 때 실행.
  3. **수면 상태 업데이트 단계**: `update_rigid_body_sleep_states` 내부에서 수면 가능 아일랜드를 판별할 때 실행.
* **영향**: 강체와 콜라이더 수가 늘어날수록 CPU 캐시 미스 및 연산 부하가 기하급수적으로 폭증하여 60fps/144fps 실시간 런타임 버젯을 쉽게 초과하고 게임 성능을 저하시킵니다.
* **개선안**: 서브스텝 시작 시 생성한 충돌 매니폴드를 재사용할 수 있도록 `RigidBodyStepScratch`에 캐시 필드를 구축하고 공유하는 구조로 리팩토링해야 합니다.

### 2.2. KCC 충돌 마진(Skin/Shell) 부재에 의한 경계 지면 수치 진동 및 게임 FSM 꼬임
* **대상 파일**:
  - `crates/ferrum-core/src/physics/platformer_controller/ground_probe.rs`
  - `crates/ferrum-core/src/physics/platformer_controller/kinematic_sweep.rs`
* **문제점**:
  캐릭터 AABB가 벽이나 바닥에 비벼질 때, 충돌 스위핑 결과에서 거리 마진(Collision Skin) 없이 정확히 접촉 거리 $0.0$에 맞닿게 캐릭터 위치를 갱신합니다. 이로 인해 부동 소수점 오차가 누적되어 다음 프레임 검사 시 미세하게 공중에 떠 있거나 바닥에 침투해 있는 것으로 판단됩니다.
* **실시간 오작동 현상**:
  캐릭터가 바닥에 가만히 서 있을 때조차 `ground_probe`의 결과가 매 프레임 `Some(Hit)`과 `None`을 번갈아 가며 진동(Jittering)합니다. 이로 인해 게임 플레이 단에서 다음과 같은 버그가 꼬리에 꼬리를 물고 발생합니다.
  - **애니메이션 상태 진동**: 캐릭터 애니메이션 상태 머신(FSM)이 Grounded와 Falling 상태를 초당 수십 번 왕복하면서 스프라이트가 어색하게 흔들림.
  - **플레이 제어 결함**: 공중 판정 프레임에서 점프 입력이 씹히거나 코요테 시간(Coyote time) 타이머가 비정상적으로 소모됨.
* **개선안**: 스윕 알고리즘 내에 약 $0.01 \sim 0.1$ 픽셀 두께의 `Skin` 마진을 두어, 실제 물리적 위치는 표면에서 `Skin`만큼 덜 간 곳에 멈추게 하고, 지면 감지 프로브는 `Skin + $\epsilon$` 크기로 검사하여 안정한 접촉 판정을 고정해야 합니다.

### 2.3. Spring Joint의 이터레이션(Iteration) 횟수 의존적 탄성 거동
* **대상 파일**: `crates/ferrum-core/src/physics/joints/spring_joint.rs#L50-L73`
* **공식**:
  ```rust
  let spring_velocity = context.error * stiffness / (delta_seconds * iteration_count);
  ```
* **문제점**:
  속도 해결사 루프 내에서 스프링력을 속도 보정으로 근사할 때, 반복 횟수인 `iteration_count`로 나눈 값을 바이어스로 사용합니다. 이는 수치 조절에 따른 편법 근사식으로, 실제 물리적인 고유 진동수(Frequency Hz)와 감쇠비(Damping ratio)를 만족하지 못합니다.
* **영향**: 게임 성능 튜닝을 위해 속도 반복 횟수(`velocity_iterations`) 옵션을 $4$에서 $8$로 변경하면, 스프링 조인트의 강도와 출렁거림이 강제로 변하게 되어 물리 연산 품질에 일관성을 보장할 수 없습니다.
* **개선안**: 주파수(Hz)와 감쇠비를 매개변수로 받아 시간 간격($\Delta t$) 및 이터레이션 수에 불변인 **Soft Constraint (implicit Euler spring integration)** 공식을 사용하여 강도 계수를 정식 유도해야 합니다.

### 2.4. 강체 댐핑(Linear/Angular Damping) 및 파티클 감속의 주사율(FPS) 종속성
* **대상 파일**:
  - `crates/ferrum-core/src/physics/rigid_body_step/integration.rs#L82-L93`
  - `crates/ferrum-core/src/particles.rs#L226-L228`
* **문제점**:
  강체의 속도/각속도 댐핑 및 비주얼 파티클 업데이트 시 1차 오일러 감속 근사식 `damping_factor = 1.0 - damping * delta_seconds`를 사용합니다.
* **영향**: 60Hz 대 144Hz 기기 환경에 따라 마찰력에 의한 이동 거리가 달라지며, 감쇄 상수가 클 경우 강체의 역방향 튐을 방지하기 위한 clamp 처리에 의해 거동이 왜곡됩니다.
* **개선안**: 프레임 레이트 독립성을 만족하기 위해 지수 감속 수식($e^{-d\Delta t}$) 또는 역수 기반 감쇠식($\frac{1}{1 + d\Delta t}$)으로 개편해야 합니다.

### 2.5. Pulley Joint (도르래 조인트)의 부등식 제약조건 부재 (막대 제약화)
* **대상 파일**: `crates/ferrum-core/src/physics/joints/pulley_joint.rs`
* **문제점**:
  도르래 줄은 팽팽할 때는 제약조건이 작동하고, 느슨해질 때는 작동하지 않아야 하므로 부등식 제약(Inequality Constraint, $C \ge 0$)으로 풀어야 합니다. 그러나 현재 구현은 줄의 상태와 무관하게 항상 에러를 강제 일치시키는 등식 제약(Equality Constraint)으로 해결합니다.
* **영향**: 도르래 한쪽에 매달린 물체를 수동으로 위로 들어 올릴 때 줄이 자연스럽게 접히는 것이 아니라, 반대쪽 물체가 강제로 밑으로 당겨 내려갑니다. 밧줄이 아닌 고정된 "기어 쇠막대"처럼 작동하여 매우 비현실적인 기믹 제한이 걸립니다.

### 2.6. 움직이는 플랫폼(Moving Platform)의 회전 성분 미상속
* **대상 파일**:
  - `crates/ferrum-core/src/physics/platformer_controller/moving_platform.rs`
  - `crates/ferrum-core/src/physics/platformer_controller.rs#L140-L156`
* **문제점**:
  캐릭터가 움직이는 플랫폼 위에 올라탔을 때 플랫폼의 선선속도에 의한 이동 변위(`displacement`)만 캐릭터의 위치에 누적하여 전송합니다. 만약 플랫폼이 회전한다면 플랫폼 위의 캐릭터가 가져야 할 회전 궤적 선속도 성분인 $\mathbf{v}_{rot} = \omega_{platform} \times \mathbf{r}_{offset}$ 및 각도 변화율이 누락됩니다.
* **영향**: 회전판이나 관람차 같은 회전하는 플랫폼 위에 캐릭터가 올라섰을 때, 미끄러지며 관성 없이 밖으로 밀려 떨어지는 어색함이 발생합니다.

### 2.7. 캐릭터 컨트롤러(KCC)의 O(N) 스윕 검색 및 계단 검사 연산 폭증
* **대상 파일**:
  - `crates/ferrum-core/src/physics/platformer_controller/kinematic_sweep.rs#L51`
  - `crates/ferrum-core/src/physics/platformer_controller/step_offset.rs#L39-L136`
* **문제점**:
  1. **공간 가속 없는 전수 검사**: 캐릭터가 매 스위핑 이동 시 월드 전체의 생존 엔티티(`world.alive_indices()`)를 매번 루프로 선형 순회하며 AABB 교차를 검사합니다.
  2. **계단 검사의 오버헤드**: 턱을 올라갈 수 있는지 확인하기 위해 최악의 경우 한 프레임 내에 `move_and_slide_internal`을 4회 연속 호출합니다. 이때 매 스윕마다 전체 오브젝트 탐색이 발생하여 CPU 연산 횟수가 폭발적으로 가중됩니다.
* **영향**: 월드에 충돌성 엔티티가 늘어나거나 다수의 몹/플레이어가 벽이나 계단 부근에서 엉켜 비벼질 때 극심한 CPU 프레임 드랍이 일어납니다.
* **개선안**: 충돌 후보군을 사전에 거르는 Broadphase(예: Dynamic AABB Tree, Grid) 필터를 연계하고, 계단 검사 전 가벼운 레이캐스팅을 통한 조기 탈출(Early out) 조건을 선행해야 합니다.

### 2.8. 일방향 플랫폼(One-Way Platform) 통과 도중 최고점 낙하 시 캐릭터 끼임 현상
* **대상 파일**: `crates/ferrum-core/src/physics/platformer_controller/solid_filter.rs#L36-L50`
* **문제점**:
  낙하 방향 판별(`remaining.vy > KINEMATIC_EPSILON`) 및 앵커 표면 조건(`mover_bottom <= platform_top + KINEMATIC_EPSILON`)을 기준으로 단일 시점 충돌 차단을 진행합니다. 아래에서 위로 플랫폼을 통과하며 점프하는 도중 몸의 일부(예: 발)가 경계를 갓 지난 겹침 상태에서 최고점에 도달해 순간 낙하하기 시작하면, 그 즉시 플랫폼 상단 충돌이 발현되어 캐릭터가 플랫폼 한가운데 갇혀 끼는 현상(Stuck)을 빚습니다.
* **개선안**: 이전 프레임 지상에 있었는지 여부를 트래킹하는 이력 상태 머신이나 상대 궤적 누적 판정을 선행하여 해결해야 합니다.

### 2.9. 접촉 임프레스 캐시의 O(N_c * N_prev_c) 검색 병목
* **대상 파일**: `crates/ferrum-core/src/physics/solver/contact_cache.rs#L20-L28`
* **문제점**:
  웜 스타팅(Warm starting)을 위해 이전 프레임의 충격량을 룩업하는 `cached_contact_impulse_for_point` 함수는 매 충돌점마다 이전 충격량 전체 배열을 완전 순회(`iter().find(...)`)합니다.
* **영향**: 충돌 페어가 많은 환경에서 솔버 준비 단계의 연산 시간 지연을 초래합니다.
* **개선안**: 엔티티 고유 ID 쌍 또는 컴포넌트 인덱스 해시 키 룩업 기반으로 자료구조를 재배치하여 $O(1)$ 복잡도로 개선해야 합니다.

### 2.10. 바닥 검출(Ground Probe) 컨텍스트 내의 내적 판단 데드 코드(Dead Code)
* **대상 파일**: `crates/ferrum-core/src/physics/platformer_controller/ground_probe.rs#L63-L66`
* **문제점**:
  바닥 충돌 여부를 판단할 때 이동 변위와 충돌 법선 벡터의 내적 방향을 검사합니다.
  ```rust
  let into_normal = displacement.vx * contact.normal_x + displacement.vy * contact.normal_y;
  if contact.time <= KINEMATIC_EPSILON && into_normal <= 0.0 {
      continue;
  }
  ```
  그러나 바닥 프로브 변위 `displacement`는 수직 아래 방향(`vx: 0.0, vy: probe_distance`)으로 항상 고정되어 있으며 바닥 판정 통과 조건에 의해 `contact.normal_y`도 무조건 양수입니다. 결국 `into_normal = probe_distance * contact.normal_y`는 언제나 양수이며 `into_normal <= 0.0` 조건은 절대 참이 될 수 없습니다.
* **영향**: 불필요한 연산 오버헤드와 함께, KCC가 횡방향 혹은 경사면 궤적 스위핑을 반영하지 못하고 수직 프로브에만 경화되어 있음을 시사하는 설계상 누수입니다.

---

## 3. 고도화 및 추가 구현 권장 영역 (Advanced Feature Roadmap)

### 3.1. 아일랜드 기반 병렬 솔버 고도화 (Parallel Island Solver)
* **구현 방향**: 서로 연접하지 않고 격리된 강체/조인트 군집인 **물리 아일랜드(Island)** 연산을 `Rayon` 크레이트 또는 자체 태스크 워커 스레드 풀을 활용해 병렬로 스케줄링하여 처리합니다.
* **기대 효과**: 멀티코어 CPU의 리소스를 완전하게 사용하여 대규모 충돌 및 오브젝트 파괴 기믹 구현 시 성능을 비약적으로 끌어올릴 수 있습니다.

### 3.2. 유체 부력 및 센서 저항 (Buoyancy & Fluid Dynamics)
* **구현 방향**: 비고체(Sensor) 속성의 트리거 영역과 강체 AABB 간의 중첩 연적을 계산하여 중력 반대 방향의 **부력(Buoyancy Force)**과 속도 반대 방향의 **유체 저항(Fluid Drag)**을 적분기에 결합하는 피처를 개발합니다. 물, 용암 등의 유체 상호작용 기믹 개발을 가속합니다.

### 3.3. 2D 차량 서스펜션용 휠 조인트 (Wheel Joint)
* **구현 방향**: Revolute(회전), Prismatic(서스펜션 슬라이더), Spring(탄성 서스펜션) 제약조건을 단일 솔버 방정식으로 묶은 특화 휠 조인트 컴포넌트를 추가합니다. 물리 기반 몬스터 트럭, 오토바이 등의 2D 탈것 구현을 정밀 지원합니다.

### 3.4. GGPO 넷코드를 위한 결정론적 시뮬레이션 (Deterministic Physics)
* **구현 방향**: 플랫폼/아키텍처(Wasm, x86_64, ARM) 간의 부동 소수점 오차로 인한 Desync 문제를 방지하기 위해 삼각함수, hypot, 제곱근 연산 등을 소프트웨어 정의 고정 소수점(Fixed-point) 또는 크로스 플랫폼 결정론적 부동 소수점 구현체로 고도화 격리하는 아키텍처 설계를 검토합니다.

---

## 4. 우선순위 기반 리팩토링 및 개선 로드맵

| 우선순위 | 작업 항목 | 대상 코드 | 기대 효과 |
| :--- | :--- | :--- | :--- |
| **상 (성능/가속)** | 서브스텝 내 충돌 감지 매니폴드 캐싱 도입 및 수면 판정 연산 단일화 | `rigid_body_step.rs`, `sleep.rs` | 프레임당 중복 충돌 검사를 제거하여 전체 물리 연산 속도 2~3배 이상 향상 |
| **상 (물리정밀)** | Baumgarte 복원력 정상화 (멀어질 때만 스킵 처리) | `baumgarte.rs` | 충돌 초기 단계에서의 파묻힘 및 벽 뚫림(터널링), 부자연스러운 튕김 현상 근절 |
| **상 (물리정밀)** | Gear Joint 각도 Wrap-around ($2\pi$ 노멀라이징) 보완 | `gear_joint.rs` | 기어 다회전 시의 각도 한계 폭발(Explosion) 치명적 버그 해결 |
| **상 (물리정밀)** | Distance/Spring/Rope Joint 로컬 앵커 오프셋 지원 및 회전 관성($I^{-1}$) 추가 | `distance_joint.rs`, `spring_joint.rs`, `rope_joint.rs` | 밧줄이나 탄성 끈에 매달린 강체의 토크 전달 및 각운동 시뮬레이션 지원 |
| **상 (물리정밀)** | Weld Joint 위치 보정기 각도 보정 로직 보완 (Jitter 근절) | `weld_joint.rs` | 강체 용접부의 각도/위치 일치 수렴성 확보 및 떨림(Jitter) 현상 제거 |
| **상 (성능/이동)** | Step Offset 연산 최적화 (Early Raycast out 도입) | `step_offset.rs` | 다중 KCC 비빔 연산 시 AABB 스윕 폭증 병목 방지 |
| **상 (물리정밀)** | 미세 지속 외력 인가 시 영구 수면 불능 버그 수정 (임계력 필터링 도입) | `sleep.rs`, `integration.rs` | 마찰로 멈춘 물체들의 비정상 수면 타이머 리셋 및 CPU 점유 폭주 방지 |
| **상 (물리정밀)** | HD2D Bridge 관통 감지 시 이산 보간 스킵 터널링 해결 | `hd2d_kinematic.rs` | 고속 이동 캐릭터의 다리 관통 및 비정상 스냅 오류 방지 |
| **상 (이동/안정)** | KCC 점프 상승 중 턱(Step Offset) 오르기 제한 완화 | `step_offset.rs` | 점프 상승 궤적 중 턱에 충돌 시 멈춤 및 스냅 현상 방지 |
| **중 (이동/안정)** | KCC 경사면 속도 증폭 왜곡 해결 (경사 투영 변위 적용) | `slope_ground.rs` | 가파른 경사면 기어오를 때 선속도가 부스트되어 빨라지는 기하학적 왜곡 해결 |
| **중 (이동/안정)** | KCC 충돌체 외각 `Skin` 마진 도입 및 수치 진동 보정 | `ground_probe.rs`, `kinematic_sweep.rs` | 지면 밀착 상태 유지 시 착지/공중 FSM 판정 Jitter 오작동 방지 |
| **중 (물리정밀)** | Revolute Joint의 회전 한계 범위 누적 각도 추적화 (180도 축소 결함 해소) | `limits.rs`, `revolute_joint.rs` | 감싸기 필터링 분리를 통해 다회전 각도 제한 기믹 정상 지원 |
| **중 (일관성)** | 강체 댐핑 식 및 파티클 감속 식을 지수 감쇄($e^{-d\Delta t}$)로 리팩토링 | `integration.rs`, `particles.rs` | FPS 변동 시의 물리 마찰 및 파티클 감속 분포 동일성 유지 |
| **중 (이동/안정)** | Moving Platform 회전 각속도에 따른 선속도 기여분 캐릭터 이식 | `moving_platform.rs` | 회전판 및 대관람차 탑승 시 미끄러져 추락하는 결함 해결 |
| **중 (이동/안정)** | 일방향 플랫폼 관통 시 최고점 전환기 stuck 현상 해결 | `solid_filter.rs` | 플랫폼 한가운데서 떨어질 때 끼임 현상 근절 |
| **중 (가속)** | 접촉 캐시 자료구조 룩업 O(1) 해시화 | `contact_cache.rs` | 다중 충돌 시의 솔버 준비 단계 웜스타트 루프 병목 단축 |
| **하 (예외처리)** | Multi-point 발바닥 감지 경 경사로 snap 보간 | `slope_ground.rs` | 캐릭터 AABB 모서리 경사 디딤 시 공중 부양 시각 오류 제거 |
| **하 (고도화)** | 아일랜드 기반 병렬 솔버 도입 (`Rayon` 스케줄링) | `islands.rs`, `rigid_body_step.rs` | 멀티코어 환경 최적화를 통한 대규모 물리 객체 지원 |
| **하 (이동/제약)** | Pulley Joint 느슨해짐(Inequality) 제약조건화 | `pulley_joint.rs` | 줄의 성격을 가진 자연스러운 도르래 상호작용 달성 |
| **하 (무결성)** | CCD 임팩트 시간 $\Delta t$ 매개변수 연동 | `ccd.rs` | 복원력 수치 안정성 잠재 결함 제거 |
| **하 (가독성)** | `sanitize_non_negative` 부등식 조건와 명칭 일치화 (`>= 0.0`) | `math.rs` | 정적 분석 시 명칭-수식 괴리 혼동 방지 |
| **하 (가독성)** | Ground Probe 내적 판단 조건식 데드 코드 정리 | `ground_probe.rs` | 불필요한 연산 가독성 개선 |
