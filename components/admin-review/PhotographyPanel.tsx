"use client";

import { useState } from "react";
import { CandidatePhoto, DRAFT_HINT, HeroPhotoCandidatesPanel, shortDate, useCanPublish } from "@/components/AdminCandidates";
import { Chip, Section, quietButton } from "./ui";
import type { SectionProps } from "./types";

/*
  C. Photography. The existing exact-location Google photo workflow, unchanged, behind two explicit buttons.

  Google Places lookups are billable, so NOTHING is requested when the page opens: the stored selection comes
  from our own database (the review response), and Google is only called after you press a button. FoodSwipe
  stores only which photo number was approved; the image itself stays on Google and is always shown with its
  author attribution and Maps link (handled by the existing panels).
*/
export default function PhotographyPanel({ review, secret, onChanged }: SectionProps) {
  const { candidate } = review;
  const canPublish = useCanPublish();
  const [browse, setBrowse] = useState(false);
  const [preview, setPreview] = useState(false);
  const selection = candidate.heroMediaSelection ?? null;
  const hasPlace = Boolean(candidate.googlePlaceId);

  return (
    <Section
      id="photo" title="Photography" icon="photo_library"
      chip={selection ? <Chip tone="mint">Hero approved · photo #{selection.selectedPhotoOrdinal}</Chip> : <Chip tone="saffron">No hero approved</Chip>}
    >
      <p className="text-[11px] text-haze">
        {selection
          ? <>Approved hero: Google place photo #{selection.selectedPhotoOrdinal} of this exact place{selection.approvedAt ? `, approved ${shortDate(selection.approvedAt)}` : ""}. It appears on the profile after the restaurant is published.</>
          : "No hero photo is approved. Until one is, the profile uses a logo or placeholder. Choosing a hero is optional for publishing."}
      </p>
      <p className="mt-1 text-[10px] text-haze">Photos stay on Google. FoodSwipe stores only the photo number, never the image.</p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {!browse ? (
          <button type="button" onClick={() => setBrowse(true)} disabled={!hasPlace} className={quietButton} data-testid="browse-photos">
            Browse Google photo candidates
          </button>
        ) : (
          <button type="button" onClick={() => setBrowse(false)} className={quietButton}>Close photo candidates</button>
        )}
        {!preview ? (
          <button type="button" onClick={() => setPreview(true)} className={quietButton}>Show current hero preview</button>
        ) : (
          <button type="button" onClick={() => setPreview(false)} className={quietButton}>Hide hero preview</button>
        )}
        <span className="text-[10px] text-haze">
          {hasPlace ? "Each lookup is a billable Google Places request." : "Needs a Google Place ID: add one under Identity."}
        </span>
      </div>
      {!canPublish && <p className="mt-1 text-[11px] text-saffron">Browsing is allowed, but choosing the hero needs the publication credential. {DRAFT_HINT}</p>}

      {preview && (
        <div className="mt-3 max-w-xs">
          <CandidatePhoto candidateId={candidate.id} secret={secret} name={candidate.name} />
          <p className="mt-1 text-[10px] text-haze">What the profile would currently show: the approved hero if any, otherwise the fallback.</p>
        </div>
      )}
      {browse && hasPlace && (
        <div className="mt-3">
          <HeroPhotoCandidatesPanel
            candidateId={candidate.id}
            googlePlaceId={candidate.googlePlaceId}
            secret={secret}
            name={candidate.name}
            onSelectionChanged={() => onChanged()}
          />
        </div>
      )}
    </Section>
  );
}
