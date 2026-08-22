class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function requireFields(obj, fields) {
  for (const f of fields) {
    if (obj?.[f] === undefined || obj?.[f] === null || obj?.[f] === '') {
      throw new ApiError(400, `الحقل "${f}" مطلوب`);
    }
  }
}

function toIntOrThrow(value, label = 'المعرّف') {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new ApiError(400, `${label} غير صالح`);
  return n;
}

module.exports = { ApiError, requireFields, toIntOrThrow };
