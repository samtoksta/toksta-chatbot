import React, { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger,
  DialogClose
} from "@/components/ui/dialog";
import { ChevronLeft, ChevronRight, ExternalLink, X } from "lucide-react";

// Mirroring the structure from tools_vectors.json / seed.ts
export interface ToolCardProps {
  id: string;
  name: string;
  nutshell: string;
  features: string[];
  influencer_count: number;
  reddit_sentiment_raw: number;
  logo_url: string;
  screenshot_urls: string[];
  affiliate_link: string | null;
  website: string;
}

// --- Helper Functions (specific to this component) ---

const getSentimentIcon = (score: number): string => {
  if (score > 0.5) return '👍'; // Positive
  if (score < -0.2) return '👎'; // Negative (allowing some leeway)
  return '😐'; // Neutral
};

// Updated to return Shadcn Badge
const getInfluencerBadge = (count: number): React.ReactNode => {
  if (count > 10) { // Arbitrary threshold
    return (
      <Badge variant="secondary" className="bg-purple-100 text-purple-700 hover:bg-purple-200">
        🔥 Influencer Pick
      </Badge>
    );
  }
  return null;
};

// --- Tool Card Component ---

export function ToolCard({ 
  id, 
  name, 
  nutshell, 
  features, 
  influencer_count, 
  reddit_sentiment_raw, 
  logo_url, 
  screenshot_urls, 
  affiliate_link, 
  website
}: ToolCardProps) {

  const visitUrl = affiliate_link || website;
  const sentimentIcon = getSentimentIcon(reddit_sentiment_raw);
  const influencerBadge = getInfluencerBadge(influencer_count);
  const hasScreenshots = screenshot_urls && screenshot_urls.length > 0;
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const nextImage = () => {
    setCurrentImageIndex((prev) => 
      prev === screenshot_urls.length - 1 ? 0 : prev + 1
    );
  };

  const prevImage = () => {
    setCurrentImageIndex((prev) => 
      prev === 0 ? screenshot_urls.length - 1 : prev - 1
    );
  };

  return (
    <Card className="group relative overflow-hidden border-0 bg-background/50 shadow-sm transition-all hover:shadow-md">
      {/* Screenshot overlay - takes prominence */}
      {hasScreenshots && (
        <div className="absolute inset-0 w-full opacity-0 transition-all duration-300 group-hover:opacity-100">
          <div className="relative h-full w-full">
            <Image 
              src={screenshot_urls[0]} 
              alt={`${name} screenshot background`}
              fill
              className="object-cover opacity-10" // Kept opacity-10 for subtlety
              unoptimized
            />
            <div className="absolute inset-0 bg-gradient-to-t from-background via-background/80 to-transparent" />
          </div>
        </div>
      )}
      
      {/* Main content - Added z-10 to ensure it's above the overlay */}
      <div className="relative z-10">
        <CardHeader className="flex flex-row items-center gap-4 space-y-0 pb-2">
          <Avatar className="h-10 w-10 rounded-md border bg-background shadow-sm">
            <AvatarImage src={logo_url} alt={`${name} logo`} />
            <AvatarFallback>{name.substring(0, 2)}</AvatarFallback>
          </Avatar>
          <div className="flex-grow">
            <CardTitle className="text-lg font-medium text-foreground">{name}</CardTitle>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {influencerBadge}
              <span title={`Reddit Sentiment: ${reddit_sentiment_raw.toFixed(2)}`} className="flex items-center">
                {sentimentIcon} <span className="ml-1">{Math.abs(reddit_sentiment_raw).toFixed(1)}</span>
              </span>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4 pb-2">
          <p className="text-sm text-muted-foreground">{nutshell}</p>
          
          {hasScreenshots && (
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <DialogTrigger asChild>
                <div 
                  className="group/screenshots cursor-pointer overflow-hidden rounded-lg border"
                  onClick={() => setCurrentImageIndex(0)}
                >
                  <div className="relative aspect-video w-full overflow-hidden">
                    <Image 
                      src={screenshot_urls[0]} 
                      alt={`${name} screenshot preview`}
                      fill
                      className="object-cover transition-transform duration-500 group-hover/screenshots:scale-105"
                      unoptimized
                    />
                    {screenshot_urls.length > 1 && (
                      <div className="absolute bottom-2 right-2 rounded-full bg-background/80 px-2 py-1 text-xs font-medium backdrop-blur-sm">
                        +{screenshot_urls.length - 1} more
                      </div>
                    )}
                  </div>
                </div>
              </DialogTrigger>
              {/* UPDATED DialogContent: wider, taller, uses flex for layout */}
              <DialogContent className="max-w-7xl w-[95vw] h-[90vh] flex flex-col p-2 md:p-4">
                <DialogTitle className="sr-only">
                  {`Image gallery for ${name}`}
                </DialogTitle>
                <DialogHeader className="absolute right-2 top-2 md:right-4 md:top-4 z-50 flex flex-row items-center justify-between space-y-0">
                  <DialogClose asChild>
                    <Button 
                      variant="outline" 
                      size="icon" 
                      // UPDATED: Close button size consistent with nav buttons
                      className="h-10 w-10 rounded-full bg-background/80 backdrop-blur-sm"
                    >
                      <X className="h-6 w-6" />
                    </Button>
                  </DialogClose>
                </DialogHeader>
                
                {/* UPDATED Fullscreen image slider area: flex-1 to take available space */}
                <div className="relative flex-1 w-full min-h-0"> {/* min-h-0 for flexbox overflow control */}
                  <div className="relative h-full w-full">
                    <Image 
                      src={screenshot_urls[currentImageIndex]} 
                      alt={`${name} screenshot ${currentImageIndex + 1}`}
                      fill
                      className="object-contain" // object-contain is correct for showing full image
                      unoptimized
                      sizes="(max-width: 768px) 100vw, (max-width: 1280px) 80vw, 70vw" // Adjusted sizes
                      priority
                    />
                  </div>

                  {/* Navigation buttons */}
                  {screenshot_urls.length > 1 && (
                    <>
                      <Button 
                        variant="outline" 
                        size="icon" 
                        className="absolute left-1 top-1/2 sm:left-2 h-10 w-10 -translate-y-1/2 rounded-full bg-background/80 backdrop-blur-sm"
                        onClick={prevImage}
                      >
                        <ChevronLeft className="h-6 w-6" />
                      </Button>
                      <Button 
                        variant="outline" 
                        size="icon" 
                        className="absolute right-1 top-1/2 sm:right-2 h-10 w-10 -translate-y-1/2 rounded-full bg-background/80 backdrop-blur-sm"
                        onClick={nextImage}
                      >
                        <ChevronRight className="h-6 w-6" />
                      </Button>
                    </>
                  )}
                  
                  {/* Image counter */}
                  {screenshot_urls.length > 1 && (
                    <div className="absolute bottom-2 left-1/2 sm:bottom-4 -translate-x-1/2 rounded-full bg-background/80 px-3 py-1 text-sm backdrop-blur-sm">
                      {currentImageIndex + 1} / {screenshot_urls.length}
                    </div>
                  )}
                </div>
                
                {/* Thumbnails navigation */}
                {screenshot_urls.length > 1 && (
                  // UPDATED: Added flex-shrink-0 for flexbox layout, pb-1 for scrollbar space
                  <div className="mt-2 sm:mt-4 flex-shrink-0 hidden sm:flex overflow-x-auto">
                    <div className="flex gap-2 pb-1"> {/* pb-1 for potential scrollbar */}
                      {screenshot_urls.map((url, index) => (
                        <button
                          key={`thumb-${index}`}
                          className={`relative h-16 w-24 flex-shrink-0 overflow-hidden rounded border transition-all ${
                            currentImageIndex === index 
                              ? 'ring-2 ring-primary ring-offset-2' 
                              : 'opacity-60 hover:opacity-100' // Slightly more opacity change
                          }`}
                          onClick={() => setCurrentImageIndex(index)}
                        >
                          <Image 
                            src={url} 
                            alt={`Thumbnail ${index + 1}`}
                            fill
                            className="object-cover"
                            unoptimized
                          />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </DialogContent>
            </Dialog>
          )}
          
          {features.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {features.slice(0, 3).map((feature, index) => (
                <Badge 
                  key={index} 
                  variant="outline" 
                  className="bg-muted/50 font-normal text-foreground/70"
                >
                  {feature}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>

        <CardFooter className="flex items-center justify-between pt-3">
          <Link 
            href={`/tool/${id}`} 
            className="text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            Learn more
          </Link>
          <Button 
            asChild 
            variant="outline" 
            size="sm" 
            className="gap-1.5 rounded-full"
          >
            <Link href={visitUrl} target="_blank" rel="noopener noreferrer nofollow">
              Visit <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </CardFooter>
      </div>
    </Card>
  );
}