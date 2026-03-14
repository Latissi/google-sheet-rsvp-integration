export interface SystemConfig {
  PRIVATE_SHEETS_ID: string;
  WEBAPPURL: string;
  ENV: string;
  TRAINER_EMAIL: string;
}

export function getSystemConfig(): SystemConfig {
  const props = PropertiesService.getScriptProperties();
  const getRequired = (key: string): string => {
    const value = props.getProperty(key);
    if (!value) {
      throw new Error(`Missing required ScriptProperty: ${key}`);
    }
    return value;
  };

  return {
    PRIVATE_SHEETS_ID: getRequired('PRIVATE_SHEETS_ID'),
    WEBAPPURL: getRequired('WEBAPPURL'),
    ENV: getRequired('ENV'),
    TRAINER_EMAIL: getRequired('TRAINER_EMAIL'),
  };
}
