# Fix: Resources stuck at "pending" - ingestion never completes

## Root Cause

All resource ingestion methods (`ingestWebpage`, `ingestFaq`, `ingestPdf`) are called as fire-and-forget promises **without `await`** and **without `c.executionCtx.waitUntil()`**. Once the HTTP response is returned, the Cloudflare Worker isolate can terminate before the R2 upload and D1 status update complete, leaving resources stuck at "pending" forever.

AI Search (AutoRAG) indexing is **automatic** -- it monitors the R2 bucket every ~6 hours and indexes new/changed files. The application's job is just to get the file into R2 and update the D1 status. But the Worker kills those operations before they finish.

## Files to Modify

1. `worker/index.ts` -- 3 locations with fire-and-forget ingestion calls
2. `worker/services/resource-service.ts` -- error logging in catch blocks

---

## Change 1: POST /api/projects/:id/resources (worker/index.ts ~lines 1013-1052)

### PDF ingestion (line 1013-1019)

**Before:**
```typescript
const buffer = await fileObj.arrayBuffer();
resourceService.ingestPdf(
  project.id,
  resource.id,
  buffer,
  title.trim(),
);
```

**After:**
```typescript
const buffer = await fileObj.arrayBuffer();
c.executionCtx.waitUntil(
  resourceService.ingestPdf(
    project.id,
    resource.id,
    buffer,
    title.trim(),
  ),
);
```

### Webpage/FAQ ingestion (lines 1037-1053)

**Before:**
```typescript
// Trigger ingestion based on type
if (parsed.data.type === "webpage" && parsed.data.url) {
  // Don't await -- run in background
  resourceService.ingestWebpage(
    project.id,
    resource.id,
    parsed.data.url,
    parsed.data.title,
  );
} else if (parsed.data.type === "faq" && parsed.data.content) {
  resourceService.ingestFaq(
    project.id,
    resource.id,
    parsed.data.title,
    parsed.data.content,
  );
}
```

**After:**
```typescript
// Trigger ingestion based on type (use waitUntil to keep isolate alive)
if (parsed.data.type === "webpage" && parsed.data.url) {
  c.executionCtx.waitUntil(
    resourceService.ingestWebpage(
      project.id,
      resource.id,
      parsed.data.url,
      parsed.data.title,
    ),
  );
} else if (parsed.data.type === "faq" && parsed.data.content) {
  c.executionCtx.waitUntil(
    resourceService.ingestFaq(
      project.id,
      resource.id,
      parsed.data.title,
      parsed.data.content,
    ),
  );
}
```

---

## Change 2: POST /api/projects/:id/resources/:resourceId/reindex (worker/index.ts ~lines 1076-1113)

### Reset status + waitUntil + handle PDF reindex

**Before:**
```typescript
// Re-trigger ingestion
if (resource.type === "webpage" && resource.url) {
  resourceService.ingestWebpage(
    project.id,
    resource.id,
    resource.url,
    resource.title,
  );
} else if (resource.type === "faq" && resource.content) {
  resourceService.ingestFaq(
    project.id,
    resource.id,
    resource.title,
    resource.content,
  );
}

return c.json({ ok: true, message: "Reindexing started" });
```

**After:**
```typescript
// Reset status to pending before re-ingestion
await resourceService.updateResourceStatus(resource.id, "pending");

// Re-trigger ingestion (use waitUntil to keep isolate alive)
if (resource.type === "webpage" && resource.url) {
  c.executionCtx.waitUntil(
    resourceService.ingestWebpage(
      project.id,
      resource.id,
      resource.url,
      resource.title,
    ),
  );
} else if (resource.type === "faq" && resource.content) {
  c.executionCtx.waitUntil(
    resourceService.ingestFaq(
      project.id,
      resource.id,
      resource.title,
      resource.content,
    ),
  );
} else if (resource.type === "pdf" && resource.r2Key) {
  // Re-upload existing R2 object to trigger AI Search re-indexing
  c.executionCtx.waitUntil(
    (async () => {
      try {
        const obj = await c.env.UPLOADS.get(resource.r2Key!);
        if (!obj) {
          await resourceService.updateResourceStatus(resource.id, "failed");
          return;
        }
        const body = await obj.arrayBuffer();
        await c.env.UPLOADS.put(resource.r2Key!, body, {
          httpMetadata: { contentType: "application/pdf" },
          customMetadata: {
            context: `PDF document: ${resource.title}`,
          },
        });
        await resourceService.updateResourceStatus(resource.id, "indexed");
      } catch (err) {
        console.error(`PDF reindex failed for resource ${resource.id}:`, err);
        await resourceService.updateResourceStatus(resource.id, "failed");
      }
    })(),
  );
}

return c.json({ ok: true, message: "Reindexing started" });
```

---

## Change 3: POST /api/onboarding/:projectId/scrape (worker/index.ts ~line 564-567)

**Before:**
```typescript
// Ingest in background
resourceService
  .ingestWebpage(project.id, resource.id, settings.companyUrl, resource.title)
  .catch(() => {});
```

**After:**
```typescript
// Ingest in background (use waitUntil to keep isolate alive)
c.executionCtx.waitUntil(
  resourceService.ingestWebpage(
    project.id,
    resource.id,
    settings.companyUrl,
    resource.title,
  ),
);
```

---

## Change 4: Add error logging in resource-service.ts catch blocks

### ingestWebpage catch (line 109)

**Before:**
```typescript
} catch {
  await this.updateResourceStatus(resourceId, "failed");
}
```

**After:**
```typescript
} catch (err) {
  console.error(`Webpage ingestion failed for resource ${resourceId}:`, err);
  await this.updateResourceStatus(resourceId, "failed");
}
```

### ingestFaq catch (line 134)

**Before:**
```typescript
} catch {
  await this.updateResourceStatus(resourceId, "failed");
}
```

**After:**
```typescript
} catch (err) {
  console.error(`FAQ ingestion failed for resource ${resourceId}:`, err);
  await this.updateResourceStatus(resourceId, "failed");
}
```

### ingestPdf catch (line 159)

**Before:**
```typescript
} catch {
  await this.updateResourceStatus(resourceId, "failed");
}
```

**After:**
```typescript
} catch (err) {
  console.error(`PDF ingestion failed for resource ${resourceId}:`, err);
  await this.updateResourceStatus(resourceId, "failed");
}
```

---

## Why This Fixes the Problem

1. **`c.executionCtx.waitUntil(promise)`** tells the Cloudflare runtime: "keep this isolate alive until this promise settles, even though the HTTP response has already been sent." This is the standard Cloudflare pattern for background work in Workers.

2. **Status reset on reindex** gives the user accurate feedback that re-indexing is in progress.

3. **PDF reindex handling** fills the gap where PDFs were silently skipped during reindex. The fix re-puts the existing R2 object (with updated timestamp) which triggers AI Search to re-process it.

4. **Error logging** makes failures visible in Cloudflare Worker logs (`wrangler tail`) instead of being silently swallowed.

## Note on AI Search Indexing

AI Search automatically monitors the R2 bucket every ~6 hours and indexes new/changed files. The app correctly sets status to "indexed" after a successful R2 upload. The actual vector embedding/indexing by AI Search happens asynchronously on Cloudflare's side -- this is working as designed. The only problem was that the R2 uploads were never completing.
