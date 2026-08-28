-- CreateTable
CREATE TABLE "SlaTarget" (
    "priority" "TicketPriority" NOT NULL,
    "responseMinutes" INTEGER NOT NULL,
    "resolutionMinutes" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SlaTarget_pkey" PRIMARY KEY ("priority")
);
