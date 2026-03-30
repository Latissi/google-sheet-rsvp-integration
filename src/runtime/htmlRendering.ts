import { PublicSourceRegistrationMatchStatus, TrainingDefinition } from '../domain/types';
import { escapeHtml } from '../infrastructure/adapters/htmlEscape';
import {
  buildVerbosePublicErrorMessage,
  CancelTrainingConfirmationPayload,
  RegistrationRequestParameters,
} from './requestHandlers';

// ── Page title constants ──────────────────────────────────────────────────────

export const PUBLIC_JOIN_TITLE = 'Mitglied werden';
export const PUBLIC_PREFERENCES_TITLE = 'Trainingsauswahl';
export const PUBLIC_COMPLETION_TITLE = 'Anmeldung abgeschlossen';

// ── Exported HTML builders (testable, framework-free) ─────────────────────────

export function buildRegistrationPageHtml(
  message?: string,
  values: Pick<RegistrationRequestParameters, 'firstName' | 'lastName' | 'email' | 'gender'> = {},
  formAction: string = '',
): string {
  const selectedGender = values.gender?.trim() ?? '';

  return renderPublicPage(
    PUBLIC_JOIN_TITLE,
    [
      `<p>Öffentliche Registrierung erstellt immer ein Mitgliedskonto. Trainer werden später durch die Script-Administration freigeschaltet.</p>`,
      message ? `<p class="notice">${escapeHtml(message)}</p>` : '',
      `<form method="post" action="${escapeHtml(formAction)}" target="_top">`,
      '<input type="hidden" name="action" value="register" />',
      '<input type="hidden" name="flow" value="onboarding" />',
      renderTextField('firstName', 'Vorname', values.firstName),
      renderTextField('lastName', 'Nachname', values.lastName),
      renderEmailField('email', 'E-Mail', values.email),
      `<label><span>Geschlecht</span><select name="gender" required><option value="">Bitte wählen</option><option value="m"${selectedGender === 'm' ? ' selected' : ''}>m</option><option value="w"${selectedGender === 'w' ? ' selected' : ''}>w</option></select></label>`,
      '<button type="submit">Weiter zu den Trainings</button>',
      '</form>',
    ].join(''),
  );
}

export function buildPreferencesPageHtml(options: {
  memberId: string;
  trainingDefinitions: TrainingDefinition[];
  selectedTrainingIds?: string[];
  message?: string;
  formAction?: string;
  trainingMatchStatusMap?: Map<string, PublicSourceRegistrationMatchStatus>;
  mode?: 'onboarding' | 'manage';
}): string {
  const isOnboarding = options.mode !== 'manage';
  const selectedTrainingIds = new Set(options.selectedTrainingIds ?? []);
  const matchMap = options.trainingMatchStatusMap ?? new Map<string, PublicSourceRegistrationMatchStatus>();
  const trainingCards = buildTrainingOptions(options.trainingDefinitions).map(training => {
    const checked = selectedTrainingIds.has(training.trainingId) ? ' checked' : '';
    const matchStatus = matchMap.get(training.trainingId);
    const badge = matchStatus ? renderMatchBadge(matchStatus) : '';

    return `<label class="option"><input type="checkbox" value="${escapeHtml(training.trainingId)}"${checked} />` +
      `<span><strong>${escapeHtml(training.title)}</strong>${badge}<small>${escapeHtml(training.description)}</small></span></label>`;
  }).join('');

  return renderPublicPage(
    PUBLIC_PREFERENCES_TITLE,
    [
      isOnboarding
        ? '<p>Wähle die Trainings, für die du Erinnerungen und RSVP-Links erhalten möchtest.</p>'
        : '<p>Aktualisiere hier deine Trainings, für die du Erinnerungen und RSVP-Links erhalten möchtest.</p>',
      options.message ? `<p class="notice">${escapeHtml(options.message)}</p>` : '',
      `<form method="post" action="${escapeHtml(options.formAction ?? '')}" target="_top" onsubmit="syncTrainingIds()">`,
      '<input type="hidden" name="action" value="preferences" />',
      isOnboarding ? '<input type="hidden" name="flow" value="onboarding" />' : '',
      `<input type="hidden" name="memberId" value="${escapeHtml(options.memberId)}" />`,
      '<input type="hidden" id="subscribedTrainingIds" name="subscribedTrainingIds" value="" />',
      `<div class="options">${trainingCards || '<p>Derzeit sind keine Trainings definiert.</p>'}</div>`,
      `<button type="submit">${isOnboarding ? 'Anmeldung abschließen' : 'Einstellungen speichern'}</button>`,
      '</form>',
      '<script>',
      'function syncTrainingIds(){',
      '  var values = Array.prototype.slice.call(document.querySelectorAll(".option input:checked")).map(function(input){ return input.value; });',
      '  document.getElementById("subscribedTrainingIds").value = values.join(",");',
      '}',
      'syncTrainingIds();',
      'document.querySelectorAll(".option input").forEach(function(input){ input.addEventListener("change", syncTrainingIds); });',
      '</script>',
    ].join(''),
  );
}

export function buildOnboardingCompletionHtml(): string {
  return renderPublicPage(
    PUBLIC_COMPLETION_TITLE,
    [
      '<p>Deine Registrierung ist abgeschlossen.</p>',
      '<p>Du erhältst für deine ausgewählten Trainings künftig Erinnerungen mit direkten RSVP-Links per E-Mail.</p>',
    ].join(''),
  );
}

// ── HtmlOutput wrappers (Apps Script — not unit-testable) ─────────────────────

export function renderRegistrationPage(
  message?: string,
  values: Pick<RegistrationRequestParameters, 'firstName' | 'lastName' | 'email' | 'gender'> = {},
  formAction: string = '',
): GoogleAppsScript.HTML.HtmlOutput {
  return HtmlService.createHtmlOutput(buildRegistrationPageHtml(message, values, formAction)).setTitle(PUBLIC_JOIN_TITLE);
}

export function renderPreferencesPage(options: {
  memberId: string;
  trainingDefinitions: TrainingDefinition[];
  selectedTrainingIds?: string[];
  message?: string;
  formAction?: string;
  trainingMatchStatusMap?: Map<string, PublicSourceRegistrationMatchStatus>;
  mode?: 'onboarding' | 'manage';
}): GoogleAppsScript.HTML.HtmlOutput {
  return HtmlService.createHtmlOutput(buildPreferencesPageHtml(options)).setTitle(PUBLIC_PREFERENCES_TITLE);
}

export function renderOnboardingCompletionPage(): GoogleAppsScript.HTML.HtmlOutput {
  return HtmlService.createHtmlOutput(buildOnboardingCompletionHtml()).setTitle(PUBLIC_COMPLETION_TITLE);
}

export function renderCancelTrainingConfirmation(
  result: CancelTrainingConfirmationPayload,
  reason: string,
  formAction: string = '',
): GoogleAppsScript.HTML.HtmlOutput {
  const escapedMessage = escapeHtml(result.message);
  if (!result.ok || !result.requiresConfirmation || !result.memberId || !result.sessionId) {
    return HtmlService
      .createHtmlOutput(`<!DOCTYPE html><html><body><p>${escapedMessage}</p></body></html>`)
      .setTitle('Training absagen');
  }

  return HtmlService.createHtmlOutput(`<!DOCTYPE html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { font-family: Arial, sans-serif; margin: 0; background: #f6f2eb; color: #1f2937; }
      main { max-width: 32rem; margin: 3rem auto; background: #fff; border-radius: 12px; padding: 2rem; box-shadow: 0 12px 30px rgba(15, 23, 42, 0.12); }
      h1 { margin-top: 0; font-size: 1.5rem; }
      p { line-height: 1.5; }
      form { margin-top: 1.5rem; }
      button { background: #b42318; color: #fff; border: 0; border-radius: 999px; padding: 0.85rem 1.2rem; cursor: pointer; font-size: 1rem; }
      a { color: #1d4ed8; }
    </style>
  </head>
  <body>
    <main>
      <h1>Training absagen</h1>
      <p>${escapedMessage}</p>
      <p>Diese Aktion informiert alle Abonnenten sofort und unterdrückt weitere RSVP-Erinnerungen für dieses Training.</p>
      <form method="post" action="${escapeHtml(formAction)}" target="_top">
        <input type="hidden" name="action" value="cancel-training" />
        <input type="hidden" name="memberId" value="${escapeHtml(result.memberId)}" />
        <input type="hidden" name="sessionId" value="${escapeHtml(result.sessionId)}" />
        <input type="hidden" name="confirm" value="yes" />
        <input type="hidden" name="reason" value="${escapeHtml(reason)}" />
        <button type="submit">Absage jetzt bestätigen</button>
      </form>
      <p><a href="javascript:window.close()">Abbrechen</a></p>
    </main>
  </body>
</html>`).setTitle('Training absagen');
}

// ── Private helpers ───────────────────────────────────────────────────────────

function renderPublicPage(title: string, body: string): string {
  return `<!DOCTYPE html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      :root { color-scheme: light; }
      body { margin: 0; background: linear-gradient(180deg, #f4efe7 0%, #efe4d2 100%); color: #1f2937; font-family: Georgia, "Times New Roman", serif; }
      main { max-width: 42rem; margin: 2rem auto; background: rgba(255,255,255,0.94); border-radius: 18px; padding: 2rem; box-shadow: 0 18px 44px rgba(90, 58, 27, 0.14); }
      h1 { margin-top: 0; font-size: 2rem; }
      p { line-height: 1.6; }
      form { display: grid; gap: 1rem; margin-top: 1.5rem; }
      label { display: grid; gap: 0.35rem; font-weight: 600; }
      label span { font-size: 0.95rem; }
      input, select, button { font: inherit; }
      input, select { border: 1px solid #cdbba7; border-radius: 12px; padding: 0.85rem 1rem; background: #fffdf9; }
      button { border: 0; border-radius: 999px; padding: 0.95rem 1.4rem; background: #91522b; color: #fff; cursor: pointer; }
      .notice { background: #fff3df; border: 1px solid #e8c896; border-radius: 12px; padding: 0.85rem 1rem; }
      .match-summary { margin: 1.2rem 0 1.5rem; display: grid; gap: 0.75rem; }
      .match-summary h2 { margin: 0; font-size: 1.15rem; }
      .match-list { display: grid; gap: 0.75rem; }
      .match-card { border-radius: 14px; padding: 0.9rem 1rem; border: 1px solid #e7d5bf; background: #fffaf2; }
      .match-card strong { display: block; margin-bottom: 0.25rem; }
      .match-card small { color: #6b7280; }
      .match-card.status-matched { background: #eef8ef; border-color: #9ac69d; }
      .match-card.status-not-found { background: #fffaf2; border-color: #e7d5bf; }
      .match-card.status-ambiguous { background: #fff4dd; border-color: #e1b86c; }
      .match-card.status-gender-mismatch { background: #fdeeee; border-color: #df9d9d; }
      .match-badge { display: inline-block; font-size: 0.78rem; font-weight: 600; padding: 0.15rem 0.55rem; border-radius: 999px; margin: 0.2rem 0 0.15rem; vertical-align: middle; }
      .match-badge.status-matched { background: #d1fae5; color: #064e3b; }
      .match-badge.status-not-found { background: #fef3c7; color: #78350f; }
      .match-badge.status-ambiguous { background: #fef3c7; color: #78350f; }
      .match-badge.status-gender-mismatch { background: #fee2e2; color: #7f1d1d; }
      .options { display: grid; gap: 0.85rem; }
      .option { display: flex; gap: 0.85rem; align-items: flex-start; border: 1px solid #e7d5bf; border-radius: 14px; padding: 0.9rem 1rem; background: #fffaf2; }
      .option input { margin-top: 0.25rem; }
      .option span { display: grid; gap: 0.2rem; }
      .option small { color: #6b7280; font-size: 0.92rem; }
      @media (max-width: 640px) { main { margin: 0; min-height: 100vh; border-radius: 0; } }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(title)}</h1>
      ${body}
    </main>
  </body>
</html>`;
}

function renderTextField(name: string, label: string, value?: string): string {
  return `<label><span>${escapeHtml(label)}</span><input type="text" name="${escapeHtml(name)}" value="${escapeHtml(value ?? '')}" required /></label>`;
}

function renderEmailField(name: string, label: string, value?: string): string {
  return `<label><span>${escapeHtml(label)}</span><input type="email" name="${escapeHtml(name)}" value="${escapeHtml(value ?? '')}" required /></label>`;
}

function renderMatchBadge(status: PublicSourceRegistrationMatchStatus): string {
  const labels: Record<PublicSourceRegistrationMatchStatus, string> = {
    'matched': '✓ Bereits eingetragen',
    'not-found': '⚠ Noch nicht im Tab',
    'ambiguous': '⚠ Vorname unklar',
    'gender-mismatch': '⚠ Geschlecht stimmt nicht',
  };
  return `<span class="match-badge status-${escapeHtml(status)}">${escapeHtml(labels[status])}</span>`;
}

function buildTrainingOptions(trainingDefinitions: TrainingDefinition[]): Array<{
  trainingId: string;
  title: string;
  description: string;
}> {
  return [...trainingDefinitions]
    .sort((left, right) => left.day.localeCompare(right.day) || left.startTime.localeCompare(right.startTime) || left.trainingId.localeCompare(right.trainingId))
    .map(training => ({
      trainingId: training.trainingId,
      title: training.title?.trim() || training.trainingId,
      description: [training.day, training.startTime, training.location].filter(Boolean).join(' · '),
    }));
}
