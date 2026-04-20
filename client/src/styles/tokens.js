// Design token constants matching the YAMS GitHub-dark aesthetic
export const C = {
  bg:          '#0d1117',
  surface:     '#161b22',
  surface2:    '#1c2128',
  border:      '#30363d',
  borderLight: '#21262d',
  text:        '#e6edf3',
  muted:       '#8b949e',
  dim:         '#484f58',
  green:       '#3fb950',
  red:         '#f85149',
  amber:       '#d29922',
  blue:        '#388bfd',
  purple:      '#a371f7',
};

export function statusColor(status) {
  return status === 'running' ? C.green : status === 'crashed' ? C.red : C.dim;
}
