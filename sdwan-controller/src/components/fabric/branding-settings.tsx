'use client';

import { LoaderCircle, Trash2 } from 'lucide-react';
import Image from 'next/image';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Feedback } from '@/components/ui/feedback';
import { Input } from '@/components/ui/input';

export function BrandingSettings() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [version, setVersion] = useState(0);
  const [hasLogo, setHasLogo] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);

  async function upload(file?: File) {
    if (!file) return;
    setMessage('');
    if (file.size > 2 * 1024 * 1024) {
      setMessage('Choose an image no larger than 2 MiB.');
      return;
    }
    setBusy(true);
    try {
      const response = await fetch('/api/branding/logo', {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Logo could not be saved.');
      setVersion(Date.now());
      setHasLogo(true);
      setPreviewFailed(false);
      setMessage('Logo saved. It now appears on the login page and dashboard.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Logo could not be saved.');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function remove() {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/branding/logo', { method: 'DELETE' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Logo could not be removed.');
      setVersion(Date.now());
      setHasLogo(false);
      setPreviewFailed(false);
      setMessage('Custom logo removed. The default mark is now in use.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Logo could not be removed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>White-label logo</CardTitle>
        <CardDescription>Shown on the login screen and dashboard navigation.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <section aria-label="Logo preview" className="rounded-lg border bg-muted/30 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">Current logo</p>
            <span
              className="rounded-full border bg-background px-2.5 py-1 text-[11px] font-medium text-muted-foreground"
              aria-live="polite"
            >
              {hasLogo === null ? 'Checking…' : hasLogo ? 'Custom logo' : 'Default mark'}
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex min-h-24 items-center justify-center rounded-lg border bg-white p-4">
              {/* The changing query refreshes the public image after an upload or removal. */}
              <div className="relative flex w-full items-center justify-center">
                {hasLogo === true && (
                  <Image
                    key={version}
                    src={`/api/branding/logo${version ? `?v=${version}` : ''}`}
                    alt="Current organization logo preview on a light background"
                    width={600}
                    height={180}
                    unoptimized
                    style={{ width: 'auto', height: 'auto' }}
                    onError={() => setPreviewFailed(true)}
                    className="max-h-12 max-w-full object-contain"
                  />
                )}
                {hasLogo !== true || previewFailed ? (
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    {hasLogo ? 'Logo preview unavailable' : 'Default mark is in use'}
                  </span>
                ) : null}
              </div>
              <span className="sr-only">Light background</span>
            </div>
            <div className="flex min-h-24 items-center justify-center rounded-lg border bg-[#153a33] p-4">
              {hasLogo === true && !previewFailed ? (
                <Image
                  key={`dark-${version}`}
                  src={`/api/branding/logo${version ? `?v=${version}` : ''}`}
                  alt="Current organization logo preview on a dark background"
                  width={600}
                  height={180}
                  unoptimized
                  style={{ width: 'auto', height: 'auto' }}
                  className="max-h-12 max-w-full object-contain"
                />
              ) : (
                <span className="text-xs text-white/75">Default mark preview</span>
              )}
            </div>
          </div>
          <p className="mt-3 text-xs leading-5 text-muted-foreground">
            Preview how the mark looks on light and dark surfaces. Transparent backgrounds work well
            when the logo has enough contrast.
          </p>
        </section>
        <div className="space-y-2">
          <label htmlFor="brand-logo" className="text-sm font-medium">
            Upload a logo
          </label>
          <Input
            id="brand-logo"
            aria-label="Upload a logo"
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={busy}
            onChange={(event) => void upload(event.target.files?.[0])}
          />
          <p className="text-xs leading-5 text-muted-foreground">
            PNG, WebP, or JPEG · up to 2 MiB. For best results, use a 600 × 180 px image (about
            3:1). It scales to fit without cropping.
          </p>
        </div>
        {(busy || message) && (
          <Feedback
            tone={
              busy
                ? 'loading'
                : message.includes('saved') || message.includes('removed')
                  ? 'success'
                  : 'error'
            }
            presentation="panel"
            className="flex items-center gap-2"
          >
            {busy && <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />}
            {busy ? 'Saving logo…' : message}
          </Feedback>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <p className="text-xs text-muted-foreground">
            Changes take effect as soon as the upload completes.
          </p>
          {hasLogo && (
            <Button type="button" variant="outline" disabled={busy} onClick={() => void remove()}>
              <Trash2 /> Remove logo
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
