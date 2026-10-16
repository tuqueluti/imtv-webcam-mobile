import Studio from './Studio';
export const dynamic = 'force-dynamic';
export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const mode = params.mode === 'camera' || params.mode === 'receiver' ? params.mode : 'auto';
  const clean = params.clean === '1';
  return <Studio initialMode={mode} initialClean={clean}/>;
}
