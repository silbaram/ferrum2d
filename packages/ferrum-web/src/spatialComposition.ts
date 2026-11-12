/** Private pass selection from the validated native v6..v13 environment. */
export function spatialSeparated(values: Float32Array | undefined): boolean {
  return (values?.length === 544 || values?.length === 576 || values?.length === 580 || values?.length === 584 || values?.length === 592 || values?.length === 600 || values?.length === 608 || values?.length === 616) && values[528] === 1;
}

export function spatialIndirectPass(values: Float32Array | undefined): boolean {
  return spatialSeparated(values) && values![132] === 1 && values![133] > 0;
}

export function spatialDofPass(values: Float32Array | undefined): boolean {
  return spatialSeparated(values) && (values![0] & 4) !== 0 && values![62] > 0 && values![63] > 0
    && values![128] === 1 && values![129] > 0;
}
