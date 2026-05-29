import { PROVIDERS, type ProviderId } from '../../main/s3/providers';

export interface UiProvider {
  id: ProviderId;
  label: string;
}

export const UI_PROVIDERS: UiProvider[] = PROVIDERS.map((p) => ({ id: p.id, label: p.label }));
