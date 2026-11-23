import type { AdminEventView } from "@/lib/adminAudit";
import type { EvidenceStage, MapReadiness, ReviewChecklist, ReviewerDeclaration } from "@/lib/adminReview";
import type { PublicationCheck } from "@/lib/publicationChecks";
import type { AssociationSummary, VideoCandidate } from "@/lib/db/videoCandidates";
import type { AdminScope, Candidate } from "@/components/AdminCandidates";

/** One video lead as the review route returns it. */
export interface ReviewVideo extends VideoCandidate {
  association: AssociationSummary | null;
  linkedBy: "id" | "slug";
  canEmbed: boolean;
  verticalEmbed: boolean;
  stages: EvidenceStage[];
  declaration: ReviewerDeclaration | null;
}

/** Response of GET /api/admin/restaurants/candidates/[id]/review. */
export interface ReviewPayload {
  candidate: Candidate;
  promoted: { id: string; slug: string; status: string; market: string } | null;
  publicationChecks: PublicationCheck[];
  videos: ReviewVideo[];
  mapReadiness: MapReadiness;
  checklist: ReviewChecklist;
  audit: { visible: boolean; events: AdminEventView[] };
  adminScope: AdminScope;
}

/** What every section receives: the loaded review, the credential, and a way to refresh after a change. */
export interface SectionProps {
  review: ReviewPayload;
  secret: string;
  onChanged: () => void;
}
