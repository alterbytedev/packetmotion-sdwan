const DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
};

const DATE_TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  ...DATE_OPTIONS,
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
  timeZoneName: 'short',
};

export function formatDate(value: Date | string, timeZone = 'UTC') {
  return new Intl.DateTimeFormat('en-US', { ...DATE_OPTIONS, timeZone }).format(new Date(value));
}

export function formatDateTime(value: Date | string, timeZone = 'UTC') {
  return new Intl.DateTimeFormat('en-US', { ...DATE_TIME_OPTIONS, timeZone }).format(new Date(value));
}

export function formatTime(value: Date | string, timeZone = 'UTC') {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short', timeZone,
  }).format(new Date(value));
}
