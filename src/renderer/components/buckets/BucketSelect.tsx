import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useBuckets } from '../../hooks/useBuckets';
import { Combobox } from '../ui/Combobox';
import { CreateBucketDialog } from './CreateBucketDialog';

export function BucketSelect({
  accountId,
  selectedBucket,
  onSelect,
}: {
  accountId: string | null;
  selectedBucket: string | null;
  onSelect: (bucket: string) => void;
}) {
  const { t } = useTranslation();
  const buckets = useBuckets(accountId);
  const [creating, setCreating] = useState(false);

  const placeholder =
    accountId === null
      ? t('buckets.selectAccountFirst')
      : buckets.isLoading
        ? t('common.loading')
        : t('buckets.selectBucket');

  return (
    <>
      <Combobox
        items={(buckets.data ?? []).map((b) => ({ value: b, label: b }))}
        value={selectedBucket}
        onSelect={onSelect}
        placeholder={placeholder}
        ariaLabel={t('buckets.ariaBucket')}
        disabled={accountId === null}
        loading={buckets.isLoading && accountId !== null}
        footerAction={
          accountId !== null
            ? { label: t('buckets.quickCreate'), onClick: () => setCreating(true) }
            : undefined
        }
      />
      {creating && accountId !== null && (
        <CreateBucketDialog
          accountId={accountId}
          onClose={() => setCreating(false)}
          onCreated={(name) => {
            setCreating(false);
            onSelect(name);
          }}
        />
      )}
    </>
  );
}
