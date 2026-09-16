import { changeBookingStageAction } from "@/app/booking-actions";
import {
  PipelineStagePath,
  type PipelineStageOption,
} from "@/components/pipeline-stage-path";

export function BookingStagePath({
  bookingId,
  currentStageKey,
  stages,
}: {
  bookingId: string;
  currentStageKey: string;
  stages: readonly PipelineStageOption[];
}) {
  return (
    <PipelineStagePath
      action={changeBookingStageAction}
      hiddenFields={{ bookingId }}
      currentStageKey={currentStageKey}
      stages={stages}
      pipeline="booking"
      ariaLabel="Booking stage"
      hint="Select a stage, then apply. Closed Lost sits at the end of the bar."
    />
  );
}
