# Bathroom Renovation Calculator

Standalone internal calculator for bathroom renovation inspections and instant price estimates.

## Purpose

Use during a client visit to calculate a structured estimate from:
- room measurements
- demolition and preparation
- waterproofing and tiling
- plumbing and electrical changes
- sanitary product allowances
- labour cost, overhead, risk reserve and target margin
- VAT and client-facing total

## Data

The app currently uses the existing Supabase backend tables `bathroom_estimates` and `bathroom_pricing_profiles`, protected with Row Level Security.

## Deployment

Deploy this repository as its own Vercel project. It is completely separate from the Reno Rangers website repository.

## Saving and gallery

- Estimates are saved in Supabase table `bathroom_estimates`.
- Pricing defaults are saved in `bathroom_pricing_profiles`.
- Inspection photo metadata is saved in `bathroom_estimate_photos`.
- Photo files are stored privately in the Supabase Storage bucket `bathroom-estimate-photos`.
- Access is restricted with Row Level Security to the signed-in owner.

## Finish systems

Wall and floor finishes can be priced independently as **Tiles**, **Mortex**, or **No new finish**. Mortex has separate editable production rates for labour hours per m² and material cost per m².
