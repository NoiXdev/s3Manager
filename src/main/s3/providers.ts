export type ProviderId = 'amazon-s3' | 'hetzner';

export interface ProviderDef {
  id: ProviderId;
  label: string;
  forcePathStyle: boolean;
  /** Returns the endpoint URL, or undefined to let the AWS SDK derive it. */
  resolveEndpoint(region: string): string | undefined;
}

export const PROVIDERS: ProviderDef[] = [
  {
    id: 'amazon-s3',
    label: 'Amazon S3',
    forcePathStyle: false,
    resolveEndpoint: () => undefined,
  },
  {
    id: 'hetzner',
    label: 'Hetzner Object Storage',
    forcePathStyle: true,
    resolveEndpoint: (region) => `https://${region}.your-objectstorage.com`,
  },
];

export function getProvider(id: ProviderId): ProviderDef {
  const provider = PROVIDERS.find((p) => p.id === id);
  if (!provider) throw new Error(`Unknown provider: ${id}`);
  return provider;
}

export function resolveEndpoint(id: ProviderId, region: string): string | undefined {
  return getProvider(id).resolveEndpoint(region);
}
