export function certificationIssueLabel(value: string | null | undefined): string {
  if (!value?.trim()) return 'Issue date not recorded';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Issue date not recorded';
  return `Issued ${new Intl.DateTimeFormat('en-NP', {
    timeZone: 'Asia/Kathmandu', dateStyle: 'medium',
  }).format(date)}`;
}
