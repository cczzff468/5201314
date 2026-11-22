declare module 'jsmediatags' {
  interface MediaTagsResult {
    title?: string;
    artist?: string;
    album?: string;
    year?: string;
    genre?: string;
    track?: string;
    lyrics?: string;
    picture?: {
      format: string;
      data: number[];
    };
  }

  export interface ReadTagsOptions {
    file: File | Blob;
    onSuccess: (result: { tags: MediaTagsResult }) => void;
    onError: (error: Error) => void;
  }

  export function read(options: ReadTagsOptions): void;

  const jsmediatags: { read: typeof read };
  export default jsmediatags;
}
