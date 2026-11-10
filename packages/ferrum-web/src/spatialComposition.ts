/** Private pass selection from the validated native v6 environment. */
export function spatialSeparated(values: Float32Array | undefined): boolean {
  return values?.length === 544 && values[528] === 1;
}

export function spatialIndirectPass(values: Float32Array | undefined): boolean {
  return spatialSeparated(values) && values![132] === 1 && values![133] > 0;
}

export function spatialDofPass(values: Float32Array | undefined): boolean {
  return spatialSeparated(values) && (values![0] & 4) !== 0 && values![62] > 0 && values![63] > 0
    && values![128] === 1 && values![129] > 0;
}
