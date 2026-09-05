import {
  containsNonPlainPathSource,
  extractDirectUserAbsolutePathCandidates,
} from '@/helpers/executionContext';

const ZH_PERSISTENT_INTENT =
  /(?:持续|接下来|今后|以后|后续|之后|从现在开始)[\s\S]{0,40}(?:开发|工作|执行|运行|写代码|改代码|做项目)|(?:开发|工作|执行|运行|写代码|改代码|做项目)[\s\S]{0,40}(?:持续|接下来|今后|以后|后续|之后)/u;
const EN_PERSISTENT_INTENT =
  /(?:from now on|going forward|for the next|in the coming|continue|keep)[\s\S]{0,80}(?:develop|work|run|execute|code|implement)|(?:develop|work|run|execute|code|implement)[\s\S]{0,80}(?:from now on|going forward|for the next|in the coming|continue|keep)/i;
const NEGATED_INTENT =
  /(?:不要|不用|不需要|别)[\s\S]*(?:持续|接下来|今后|以后|后续|之后|绑定|工作空间)|(?:do not|don't|dont|no need to)[\s\S]*(?:continue|keep|bind|workspace)/i;

export interface WorkspaceBindingIntent {
  rootPath: string;
}

/**
 * Conservatively recognizes an explicit request to keep working in one
 * directory. It only proposes a confirmation; it never creates or binds a
 * workspace. Rich/injected sources and ambiguous multi-directory prose are
 * rejected so references cannot silently become primary cwd authority.
 */
export const detectWorkspaceBindingIntent = (params: {
  hasAttachments: boolean;
  message: string;
}): WorkspaceBindingIntent | undefined => {
  if (
    params.hasAttachments ||
    containsNonPlainPathSource(params.message) ||
    NEGATED_INTENT.test(params.message) ||
    (!ZH_PERSISTENT_INTENT.test(params.message) && !EN_PERSISTENT_INTENT.test(params.message))
  ) {
    return undefined;
  }

  const paths = extractDirectUserAbsolutePathCandidates(params.message);
  return paths.length === 1 ? { rootPath: paths[0] } : undefined;
};
