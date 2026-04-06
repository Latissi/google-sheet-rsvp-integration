import { TrainingDefinition } from '../domain/types';
import { escapeHtml } from '../infrastructure/adapters/htmlEscape';
import { FTW_LOGO_DATA_URI } from './publicAssets';
import {
  buildVerbosePublicErrorMessage,
  CancelTrainingConfirmationPayload,
  RegistrationRequestParameters,
} from './requestHandlers';

type PublicTrainingMatchBadgeStatus = 'matched' | 'not-found';

type PublicTrainingSheetNameMap = Map<string, string>;

// ── Page title constants ──────────────────────────────────────────────────────

export const PUBLIC_JOIN_TITLE = 'Anmeldung Trainings-Mailerinnerungen';
export const PUBLIC_PREFERENCES_TITLE = 'Trainingsauswahl';
export const PUBLIC_COMPLETION_TITLE = 'Anmeldung abgeschlossen';
export const PUBLIC_RSVP_RESPONSE_TITLE = 'Rückmeldung';
export const PUBLIC_CANCEL_TRAINING_TITLE = 'Training absagen';

// ── Exported HTML builders (testable, framework-free) ─────────────────────────

export function buildRsvpResponseHtml(ok: boolean, message: string): string {
  const icon = ok
    ? `<span style="font-size:3rem;color:#2d7a3a">&#10003;</span>`
    : `<span style="font-size:3rem;color:#C41230">&#9888;</span>`;
  return renderPublicPage(
    PUBLIC_RSVP_RESPONSE_TITLE,
    [
      `<div style="text-align:center;margin-bottom:1rem">${icon}</div>`,
      `<p style="text-align:center;font-size:1.1rem">${escapeHtml(message)}</p>`,
    ].join(''),
  );
}

export function buildRegistrationPageHtml(
  message?: string,
  values: Pick<RegistrationRequestParameters, 'firstName' | 'lastName' | 'email' | 'gender'> = {},
  formAction: string = '',
): string {
  const selectedGender = values.gender?.trim() ?? '';

  return renderPublicPage(
    PUBLIC_JOIN_TITLE,
    [
      `<div style="text-align:center;margin-bottom:1.25rem"><img src="${FTW_LOGO_DATA_URI}" alt="Vereinslogo" style="max-width:140px;height:auto" /></div>`,
      `<p>Mit der Anmeldung werden vorab Erinnerungen an deine Mail gesendet, wenn du noch keine Teilnahme Rückmeldung im Google Sheet gegeben hast. Die Auswahl der Trainingstermine erfolgt im nächsten Schritt.</p>`,
      message ? `<p class="notice">${escapeHtml(message)}</p>` : '',
      `<form method="post" action="${escapeHtml(formAction)}" target="_top">`,
      '<input type="hidden" name="action" value="register" />',
      '<input type="hidden" name="flow" value="onboarding" />',
      renderTextField('firstName', 'Vorname', values.firstName),
      renderTextField('lastName', 'Nachname', values.lastName),
      renderEmailField('email', 'E-Mail', values.email),
      `<label><span>Geschlecht</span><select name="gender" required><option value="">Bitte wählen</option><option value="m"${selectedGender === 'm' ? ' selected' : ''}>männlich</option><option value="w"${selectedGender === 'w' ? ' selected' : ''}>weiblich</option></select></label>`,
      '<button type="submit">Weiter zu den Trainings</button>',
      '</form>',
    ].join(''),
  );
}

export function buildPreferencesPageHtml(options: {
  memberId: string;
  existingRegistrationEmail?: string;
  trainingDefinitions: TrainingDefinition[];
  selectedTrainingIds?: string[];
  message?: string;
  formAction?: string;
  trainingMatchStatusMap?: Map<string, PublicTrainingMatchBadgeStatus>;
  trainingSheetNameMap?: PublicTrainingSheetNameMap;
  mode?: 'onboarding' | 'manage';
}): string {
  const isOnboarding = options.mode !== 'manage';
  const selectedTrainingIds = new Set(options.selectedTrainingIds ?? []);
  const matchMap = options.trainingMatchStatusMap ?? new Map<string, PublicTrainingMatchBadgeStatus>();
  const sheetNameMap = options.trainingSheetNameMap ?? new Map<string, string>();
  const existingRegistrationNotice = isOnboarding && options.existingRegistrationEmail
    ? `<p class="notice">Du bist bereits für E-Mail-Benachrichtigungen mit ${escapeHtml(options.existingRegistrationEmail)} registriert. Du kannst deine Trainings-Erinnerungen hier aktualisieren.</p>`
    : '';
  const sheetSyncExplanation = isOnboarding
    ? '<p class="info">Mit dem Speichern aktivierst du die Mail-Erinnerungen für deine Auswahl. Deine Zu- oder Absagen aus den Erinnerungsmails aktualisieren automatisch das öffentliche Trainings-Sheet. Falls dein Name in einem gewählten Trainings-Tab noch fehlt, wird er beim Speichern automatisch ergänzt.</p>'
    : '<p class="info">Mit dem Speichern aktualisierst du deine Mail-Erinnerungen für diese Trainings. Deine Zu- oder Absagen aus den Erinnerungsmails aktualisieren automatisch das öffentliche Trainings-Sheet. Falls dein Name in einem gewählten Trainings-Tab noch fehlt, wird er beim Speichern automatisch ergänzt.</p>';
  const trainingCards = buildTrainingOptions(options.trainingDefinitions).map(training => {
    const checked = selectedTrainingIds.has(training.trainingId) ? ' checked' : '';
    const matchStatus = matchMap.get(training.trainingId);
    const sheetName = sheetNameMap.get(training.trainingId);
    const badge = matchStatus && sheetName ? renderMatchBadge(matchStatus, sheetName) : '';
    const sheetReference = sheetName
      ? `<small class="sheet-reference">Trainings-Sheet, Tab: ${escapeHtml(sheetName)}</small>`
      : '';

    return `<label class="option"><input type="checkbox" value="${escapeHtml(training.trainingId)}"${checked} />` +
      `<span><strong>${escapeHtml(training.title)}</strong><small>${escapeHtml(training.description)}</small>${sheetReference}${badge}</span></label>`;
  }).join('');

  return renderPublicPage(
    PUBLIC_PREFERENCES_TITLE,
    [
      isOnboarding
        ? '<p>Wähle die Trainingstermine, für die du die Mail-Erinnerungen erhalten möchtest.</p>'
        : '<p>Aktualisiere hier deine Trainingstermine, für die du Mail-Erinnerungen erhalten möchtest.</p>',
      sheetSyncExplanation,
      existingRegistrationNotice,
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
      `<div style="text-align:center;margin-bottom:1rem"><span style="font-size:3rem;color:#2d7a3a">&#10003;</span></div>`,
      '<p>Deine Registrierung ist abgeschlossen.</p>',
      '<p>Du erhältst für deine ausgewählten Trainings künftig Erinnerungen mit Feedback-Links per E-Mail.</p>',
      '<p>Deine Zu- oder Absagen aus diesen Erinnerungsmails aktualisieren automatisch das öffentliche Trainings-Sheet. Falls dein Name in einem gewählten Trainings-Tab noch gefehlt hat, wurde er beim Speichern automatisch ergänzt.</p>',
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
  existingRegistrationEmail?: string;
  trainingDefinitions: TrainingDefinition[];
  selectedTrainingIds?: string[];
  message?: string;
  formAction?: string;
  trainingMatchStatusMap?: Map<string, PublicTrainingMatchBadgeStatus>;
  trainingSheetNameMap?: PublicTrainingSheetNameMap;
  mode?: 'onboarding' | 'manage';
}): GoogleAppsScript.HTML.HtmlOutput {
  return HtmlService.createHtmlOutput(buildPreferencesPageHtml(options)).setTitle(PUBLIC_PREFERENCES_TITLE);
}

export function renderOnboardingCompletionPage(): GoogleAppsScript.HTML.HtmlOutput {
  return HtmlService.createHtmlOutput(buildOnboardingCompletionHtml()).setTitle(PUBLIC_COMPLETION_TITLE);
}

export function buildCancelTrainingConfirmationHtml(
  result: CancelTrainingConfirmationPayload,
  reason: string,
  formAction: string = '',
): string {
  if (!result.ok || !result.requiresConfirmation || !result.memberId || !result.sessionId) {
    return renderPublicPage(
      PUBLIC_CANCEL_TRAINING_TITLE,
      `<p>${escapeHtml(result.message)}</p>`,
    );
  }

  return renderPublicPage(
    PUBLIC_CANCEL_TRAINING_TITLE,
    [
      `<p>${escapeHtml(result.message)}</p>`,
      `<p class="notice">Diese Aktion informiert alle Abonnenten sofort und unterdrückt weitere RSVP-Erinnerungen für dieses Training.</p>`,
      `<form method="post" action="${escapeHtml(formAction)}" target="_top">`,
      `<input type="hidden" name="action" value="cancel-training" />`,
      `<input type="hidden" name="memberId" value="${escapeHtml(result.memberId)}" />`,
      `<input type="hidden" name="sessionId" value="${escapeHtml(result.sessionId)}" />`,
      `<input type="hidden" name="confirm" value="yes" />`,
      `<input type="hidden" name="reason" value="${escapeHtml(reason)}" />`,
      `<button type="submit">Absage jetzt bestätigen</button>`,
      `</form>`,
      `<p><button type="button" onclick="history.back()" style="background:none;border:none;color:#C41230;cursor:pointer;padding:0;font:inherit;text-decoration:underline">Zurück</button></p>`,
    ].join(''),
  );
}

export function renderCancelTrainingConfirmation(
  result: CancelTrainingConfirmationPayload,
  reason: string,
  formAction: string = '',
): GoogleAppsScript.HTML.HtmlOutput {
  return HtmlService
    .createHtmlOutput(buildCancelTrainingConfirmationHtml(result, reason, formAction))
    .setTitle(PUBLIC_CANCEL_TRAINING_TITLE);
}

// ── Private helpers ───────────────────────────────────────────────────────────

function renderPublicPage(title: string, body: string): string {
  return `<!DOCTYPE html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      :root { color-scheme: light; }
      body { margin: 0; background: #F7F7F7; color: #1A1A2E; font-family: Arial, Helvetica, sans-serif; }
      main { max-width: 42rem; margin: 2rem auto; background: #FFFFFF; border-radius: 12px; border-top: 4px solid #C41230; padding: 2rem; box-shadow: 0 8px 24px rgba(0,0,0,0.08); }
      h1 { margin-top: 0; font-size: 2rem; }
      p { line-height: 1.6; }
      form { display: grid; gap: 1rem; margin-top: 1.5rem; }
      label { display: grid; gap: 0.35rem; font-weight: 600; }
      label span { font-size: 0.95rem; }
      input, select, button { font: inherit; }
      input, select { border: 1px solid #CCCCCC; border-radius: 8px; padding: 0.85rem 1rem; background: #FAFAFA; }
      input:focus, select:focus { border-color: #C41230; outline: none; box-shadow: 0 0 0 3px rgba(196,18,48,0.12); }
      button { border: 0; border-radius: 999px; padding: 0.95rem 1.4rem; background: #C41230; color: #fff; cursor: pointer; transition: background 0.15s; }
      button:hover { background: #9B0E24; }
      .info { background: #F3F8FF; border: 1px solid #B7CFF8; border-radius: 8px; padding: 0.85rem 1rem; }
      .notice { background: #FFF4F4; border: 1px solid #F0A0A0; border-radius: 8px; padding: 0.85rem 1rem; }
      .match-summary { margin: 1.2rem 0 1.5rem; display: grid; gap: 0.75rem; }
      .match-summary h2 { margin: 0; font-size: 1.15rem; }
      .match-list { display: grid; gap: 0.75rem; }
      .match-card { border-radius: 8px; padding: 0.9rem 1rem; border: 1px solid #E5E5E5; background: #FAFAFA; }
      .match-card strong { display: block; margin-bottom: 0.25rem; }
      .match-card small { color: #6b7280; }
      .match-card.status-matched { background: #eef8ef; border-color: #9ac69d; }
      .match-card.status-not-found { background: #FAFAFA; border-color: #E5E5E5; }
      .sheet-reference { color: #475569; font-size: 0.9rem; }
      .match-badge { display: block; font-size: 0.86rem; line-height: 1.45; font-weight: 600; padding: 0.7rem 0.85rem; border-radius: 8px; margin-top: 0.35rem; }
      .match-badge.status-matched { background: #dff5e6; color: #0f5132; }
      .match-badge.status-not-found { background: #fff4dd; color: #8a5200; }
      .options { display: grid; gap: 0.85rem; }
      .option { display: flex; gap: 0.85rem; align-items: flex-start; border: 1px solid #E5E5E5; border-radius: 8px; padding: 0.9rem 1rem; background: #FAFAFA; }
      .option input { margin-top: 0.25rem; accent-color: #C41230; }
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

function renderMatchBadge(status: PublicTrainingMatchBadgeStatus, sheetName: string): string {
  const labels: Record<PublicTrainingMatchBadgeStatus, string> = {
    'matched': `✓ Dein Name steht bereits im Trainings-Tab "${sheetName}".`,
    'not-found': `⚠ Dein Name fehlt noch im Trainings-Tab "${sheetName}". Beim Speichern wird er dort automatisch ergänzt.`,
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
