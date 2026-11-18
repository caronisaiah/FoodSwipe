import type { ReactNode, Ref } from "react";
import Link from "next/link";
import BottomNav from "@/components/BottomNav";

export default function EditorialHeader({
  skipTo, skipLabel, notice, navigationRef,
}: {
  skipTo: string;
  skipLabel: string;
  notice?: ReactNode;
  navigationRef?: Ref<HTMLDivElement>;
}) {
  return (
    <>
      <a className="editorial-skip" href={`#${skipTo}`}>{skipLabel}</a>
      <header className="editorial-masthead">
        <Link className="editorial-wordmark" href="/feed" prefetch={false} aria-label="FoodSwipe, Discover">
          Food<span>Swipe</span>
        </Link>
        <div ref={navigationRef} className="editorial-navigation">
          {notice}
          <BottomNav />
        </div>
      </header>
    </>
  );
}
