import { useMemo, useState } from 'react';

export default function useFormValidation({ initialValues, rules = {} }) {
  const [values, setValues] = useState(initialValues);
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});
  const [submitted, setSubmitted] = useState(false);

  const validateField = (name, value, nextValues = values) => {
    const validators = rules[name] || [];
    for (const fn of validators) {
      const message = fn(value, nextValues);
      if (message) return message;
    }
    return null;
  };

  const handleChange = (name, value) => {
    const nextValues = { ...values, [name]: value };
    setValues(nextValues);
    if (touched[name] || submitted) {
      const error = validateField(name, value, nextValues);
      setErrors((prev) => ({ ...prev, [name]: error }));
    }
  };

  const handleBlur = (name) => {
    setTouched((prev) => ({ ...prev, [name]: true }));
    const error = validateField(name, values[name], values);
    setErrors((prev) => ({ ...prev, [name]: error }));
  };

  const validateAll = () => {
    const nextErrors = {};
    Object.keys(rules).forEach((name) => {
      nextErrors[name] = validateField(name, values[name], values);
    });
    setErrors(nextErrors);
    setTouched(Object.keys(rules).reduce((acc, k) => ({ ...acc, [k]: true }), {}));
    setSubmitted(true);
    return Object.values(nextErrors).every((e) => !e);
  };

  const setFieldErrors = (fieldErrors = {}) => {
    setErrors((prev) => ({ ...prev, ...fieldErrors }));
  };

  const isValid = useMemo(() => Object.values(errors).every((e) => !e), [errors]);

  return {
    values,
    setValues,
    errors,
    touched,
    handleChange,
    handleBlur,
    validateAll,
    setFieldErrors,
    isValid,
  };
}
