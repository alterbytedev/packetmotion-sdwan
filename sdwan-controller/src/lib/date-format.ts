const DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  timeZone: 'UTC',
};

const DATE_TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  ...DATE_OPTIONS,
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
};

export function formatDateUtc(value: Date | string) {
  return new Intl.DateTimeFormat('en-US', DATE_OPTIONS).format(new Date(value));
}

export function formatDateTimeUtc(value: Date | string) {
  return `${new Intl.DateTimeFormat('en-US', DATE_TIME_OPTIONS).format(new Date(value))} UTC`;
}
