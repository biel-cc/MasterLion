import { mergeModelCatalogEntry } from '@lobechat/business-model-bank';
import type { EvidenceState } from '@lobechat/types/src/modelCatalog';

import { ModelItemRender } from '@/components/ModelSelect';
import { resolveChatModelCatalog } from '@/components/ModelSelect/modality';

/**
 * Shared by the production-mode and development-mode Electron bundles so
 * AC-M03 compares the *same* production rows compiled under two different
 * `sharedRendererDefine` switch sets. Keeping one fixture module means the two
 * bundles cannot silently drift apart.
 */
export interface ProductModelFixture {
  displayName: string;
  id: string;
  providerId: string;
  settings: { modelCatalog: ReturnType<typeof mergeModelCatalogEntry> };
  type: 'chat';
}

const productModel = (
  id: string,
  displayName: string,
  inputModalities?: Partial<Record<'audio' | 'file' | 'image' | 'text' | 'video', EvidenceState>>,
  endpointTypes: readonly string[] = ['chat'],
): ProductModelFixture => ({
  displayName,
  id,
  providerId: 'electron-product-provider',
  settings: {
    modelCatalog: mergeModelCatalogEntry({
      modelId: id,
      now: '2026-09-04T00:00:00.000Z',
      providerId: 'electron-product-provider',
      providerMetadata: {
        endpointTypes,
        inputModalities,
        verifiedAt: '2026-09-04T00:00:00.000Z',
      },
    }),
  },
  type: 'chat',
});

export const modelEvidence = [
  productModel('vision-chat', 'Vision chat', {
    audio: 'unsupported',
    file: 'unsupported',
    image: 'supported',
    text: 'supported',
    video: 'unsupported',
  }),
  productModel('text-chat', 'Text chat', {
    audio: 'unsupported',
    file: 'unsupported',
    image: 'unsupported',
    text: 'supported',
    video: 'unsupported',
  }),
  productModel('unverified-chat', 'Unverified chat'),
  productModel('qwen3-vl-rerank', 'Qwen rerank', undefined, ['rerank']),
];

export const chatModels = modelEvidence.filter(
  (model) => resolveChatModelCatalog(model).chatEligible,
);

interface ModelCapabilityRowsProps {
  sectionTestId: string;
  testIdPrefix: string;
}

export const ModelCapabilityRows = ({ sectionTestId, testIdPrefix }: ModelCapabilityRowsProps) => (
  <section aria-label="Model input capabilities" data-testid={sectionTestId}>
    {chatModels.map((model) => (
      <div data-model-id={model.id} data-testid={`${testIdPrefix}${model.id}`} key={model.id}>
        <ModelItemRender {...model} showInfoTag={false} />
      </div>
    ))}
  </section>
);
