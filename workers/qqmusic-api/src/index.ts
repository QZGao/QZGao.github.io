import { handleQQMusicRequest } from './router';
import { qqMusicUpstream } from './upstream';

export default {
  fetch(request: Request): Promise<Response> {
    return handleQQMusicRequest(request, qqMusicUpstream);
  },
};
