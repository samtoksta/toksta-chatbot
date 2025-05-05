import React from 'react';
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
  DialogTrigger 
} from "@/components/ui/dialog";

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
  const firstScreenshot = hasScreenshots ? screenshot_urls[0] : null;
  const MAX_INLINE_SCREENSHOTS = 1; // Show 1 initially

  return (
    <Card className="mb-4 overflow-hidden">
      <CardHeader className="flex flex-row items-start gap-4 space-y-0 pb-4">
        <Avatar className="h-10 w-10 rounded">
            <AvatarImage src={logo_url} alt={`${name} logo`} />
            <AvatarFallback>{name.substring(0, 2)}</AvatarFallback>
        </Avatar>
        <div className="flex-grow">
          <CardTitle className="text-lg mb-1">{name}</CardTitle>
          <div className="flex items-center space-x-2 text-sm text-muted-foreground">
            {influencerBadge}
            <span title={`Reddit Sentiment: ${reddit_sentiment_raw.toFixed(2)}`}>{sentimentIcon}</span>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <p className="text-sm text-muted-foreground mb-3">{nutshell}</p>
        <div className="mb-4">
          <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-1.5">Key Features:</h4>
          <ul className="list-disc list-inside text-sm space-y-1 pl-4">
            {features.slice(0, 3).map((feature, index) => (
              <li key={index}>{feature}</li>
            ))}
          </ul>
        </div>

        {/* Screenshot Section */}
        {hasScreenshots && (
          <div>
            <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-1.5">Screenshots:</h4>
            <div className="flex items-center gap-2">
              {/* Inline Thumbnails */}
              {screenshot_urls.slice(0, MAX_INLINE_SCREENSHOTS).map((url, index) => (
                 <Image 
                   key={`inline-${index}`} 
                   src={url} 
                   alt={`${name} screenshot ${index + 1}`}
                   width={100} 
                   height={75}
                   className="rounded border object-cover"
                   unoptimized
                 />
              ))}
              
              {/* Dialog Trigger if more screenshots exist */}
              {screenshot_urls.length > MAX_INLINE_SCREENSHOTS && (
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button variant="outline" size="sm">View All ({screenshot_urls.length})</Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[80%]">
                      <DialogHeader>
                        <DialogTitle>{name} - Screenshots</DialogTitle>
                      </DialogHeader>
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 py-4 max-h-[70vh] overflow-y-auto">
                        {screenshot_urls.map((url, index) => (
                           <Image 
                             key={`dialog-${index}`} 
                             src={url} 
                             alt={`${name} screenshot ${index + 1}`}
                             width={300} 
                             height={225}
                             className="rounded border object-contain w-full h-auto"
                             unoptimized
                           />
                        ))}
                      </div>
                    </DialogContent>
                  </Dialog>
              )}
            </div>
          </div>
        )}
      </CardContent>

      <CardFooter className="flex justify-end">
        <Button asChild>
            <Link href={visitUrl} target="_blank" rel="noopener noreferrer nofollow">
                Visit Site
            </Link>
        </Button>
      </CardFooter>
    </Card>
  );
} 