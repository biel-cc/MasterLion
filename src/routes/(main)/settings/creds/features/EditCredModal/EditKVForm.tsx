'use client';

import { type UserCredSummary } from '@lobechat/types';
import { Button, Flexbox } from '@lobehub/ui';
import { useMutation } from '@tanstack/react-query';
import { Alert, Form, Input } from 'antd';
import { createStaticStyles } from 'antd-style';
import { Minus, Plus } from 'lucide-react';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';

import { usePermission } from '@/hooks/usePermission';

import { useCredsApi } from '../useCredsApi';

const styles = createStaticStyles(({ css }) => ({
  footer: css`
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    margin-block-start: 24px;
  `,
  kvPair: css`
    display: flex;
    gap: 8px;
    align-items: flex-start;
  `,
}));

interface EditKVFormProps {
  cred: UserCredSummary;
  onCancel: () => void;
  onSuccess: () => void;
}

interface FormValues {
  description?: string;
  kvPairs: Array<{ key: string; value: string }>;
  name: string;
}

const EditKVForm: FC<EditKVFormProps> = ({ cred, onCancel, onSuccess }) => {
  const { t } = useTranslation('setting');
  const { allowed: canManageCredentials } = usePermission('manage_provider_key');
  const [form] = Form.useForm<FormValues>();
  const credsApi = useCredsApi();

  const updateMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      if (!canManageCredentials) return;

      const kvPairs = values.kvPairs || [];
      const valuesObj = kvPairs.reduce(
        (acc, pair) => {
          if (pair.key && pair.value) {
            acc[pair.key] = pair.value;
          }
          return acc;
        },
        {} as Record<string, string>,
      );

      await credsApi.client.update.mutate({
        description: values.description,
        id: cred.id,
        name: values.name,
        values: Object.keys(valuesObj).length > 0 ? valuesObj : undefined,
      });
    },
    onSuccess: () => {
      onSuccess();
    },
  });

  const handleSubmit = (values: FormValues) => {
    if (!canManageCredentials) return;

    updateMutation.mutate(values);
  };

  return (
    <Form<FormValues>
      form={form}
      initialValues={{
        description: cred.description,
        kvPairs: [{ key: '', value: '' }],
        name: cred.name,
      }}
      layout="vertical"
      onFinish={handleSubmit}
    >
      <Alert
        showIcon
        description={t('creds.form.replaceSecretDescription')}
        message={t('creds.form.replaceSecret')}
        style={{ marginBottom: 16 }}
        type={'info'}
      />
      <Form.Item
        label={t('creds.form.name')}
        name="name"
        rules={[{ required: true, message: t('creds.form.nameRequired') }]}
      >
        <Input disabled={!canManageCredentials} />
      </Form.Item>

      <Form.Item label={t('creds.form.values')}>
        <Form.List name="kvPairs">
          {(fields, { add, remove }) => (
            <Flexbox gap={8}>
              {fields.map(({ key, name, ...restField }) => (
                <div className={styles.kvPair} key={key}>
                  <Form.Item
                    {...restField}
                    name={[name, 'key']}
                    style={{ flex: 1, marginBottom: 0 }}
                  >
                    <Input
                      disabled={!canManageCredentials}
                      placeholder={cred.type === 'kv-env' ? 'ENV_VAR_NAME' : 'Header-Name'}
                    />
                  </Form.Item>
                  <Form.Item
                    {...restField}
                    name={[name, 'value']}
                    style={{ flex: 2, marginBottom: 0 }}
                  >
                    <Input.Password
                      disabled={!canManageCredentials}
                      placeholder={t('creds.form.valuePlaceholder')}
                    />
                  </Form.Item>
                  {fields.length > 1 && (
                    <Button
                      disabled={!canManageCredentials}
                      icon={Minus}
                      size="small"
                      type="text"
                      onClick={() => remove(name)}
                    />
                  )}
                </div>
              ))}
              <Button
                block
                disabled={!canManageCredentials}
                icon={Plus}
                type="dashed"
                onClick={() => add({ key: '', value: '' })}
              >
                {t('creds.form.addPair')}
              </Button>
            </Flexbox>
          )}
        </Form.List>
      </Form.Item>

      <Form.Item label={t('creds.form.description')} name="description">
        <Input.TextArea
          disabled={!canManageCredentials}
          placeholder={t('creds.form.descriptionPlaceholder')}
          rows={2}
        />
      </Form.Item>

      <div className={styles.footer}>
        <Button onClick={onCancel}>{t('creds.form.cancel')}</Button>
        <Button
          disabled={!canManageCredentials}
          htmlType="submit"
          loading={updateMutation.isPending}
          type="primary"
        >
          {t('creds.form.save')}
        </Button>
      </div>
    </Form>
  );
};

export default EditKVForm;
