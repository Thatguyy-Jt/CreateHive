export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      ai_generations: {
        Row: {
          completed_at: string | null
          content_idea_id: string | null
          content_item_id: string | null
          created_at: string
          error_code: string | null
          id: string
          input_tokens: number | null
          kind: string
          latency_ms: number | null
          model: string | null
          output_tokens: number | null
          prompt_version: string | null
          status: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          content_idea_id?: string | null
          content_item_id?: string | null
          created_at?: string
          error_code?: string | null
          id?: string
          input_tokens?: number | null
          kind: string
          latency_ms?: number | null
          model?: string | null
          output_tokens?: number | null
          prompt_version?: string | null
          status?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          content_idea_id?: string | null
          content_item_id?: string | null
          created_at?: string
          error_code?: string | null
          id?: string
          input_tokens?: number | null
          kind?: string
          latency_ms?: number | null
          model?: string | null
          output_tokens?: number | null
          prompt_version?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_generations_content_idea_id_user_id_fkey"
            columns: ["content_idea_id", "user_id"]
            isOneToOne: false
            referencedRelation: "content_ideas"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "ai_generations_content_item_id_user_id_fkey"
            columns: ["content_item_id", "user_id"]
            isOneToOne: false
            referencedRelation: "content_items"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "ai_generations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      analytics_snapshots: {
        Row: {
          avg_view_duration_seconds: number | null
          captured_at: string
          comments: number | null
          content_item_id: string | null
          created_at: string
          follower_delta: number | null
          id: string
          likes: number | null
          platform: string | null
          raw: Json | null
          retention_rate: number | null
          saves: number | null
          shares: number | null
          source: string
          user_id: string
          views: number | null
          watch_time_seconds: number | null
        }
        Insert: {
          avg_view_duration_seconds?: number | null
          captured_at?: string
          comments?: number | null
          content_item_id?: string | null
          created_at?: string
          follower_delta?: number | null
          id?: string
          likes?: number | null
          platform?: string | null
          raw?: Json | null
          retention_rate?: number | null
          saves?: number | null
          shares?: number | null
          source?: string
          user_id: string
          views?: number | null
          watch_time_seconds?: number | null
        }
        Update: {
          avg_view_duration_seconds?: number | null
          captured_at?: string
          comments?: number | null
          content_item_id?: string | null
          created_at?: string
          follower_delta?: number | null
          id?: string
          likes?: number | null
          platform?: string | null
          raw?: Json | null
          retention_rate?: number | null
          saves?: number | null
          shares?: number | null
          source?: string
          user_id?: string
          views?: number | null
          watch_time_seconds?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "analytics_snapshots_content_item_id_user_id_fkey"
            columns: ["content_item_id", "user_id"]
            isOneToOne: false
            referencedRelation: "content_items"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "analytics_snapshots_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      assets: {
        Row: {
          content_item_id: string | null
          created_at: string
          id: string
          mime_type: string
          name: string
          size_bytes: number
          storage_path: string
          updated_at: string
          user_id: string
        }
        Insert: {
          content_item_id?: string | null
          created_at?: string
          id?: string
          mime_type: string
          name: string
          size_bytes: number
          storage_path: string
          updated_at?: string
          user_id: string
        }
        Update: {
          content_item_id?: string | null
          created_at?: string
          id?: string
          mime_type?: string
          name?: string
          size_bytes?: number
          storage_path?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assets_content_item_id_user_id_fkey"
            columns: ["content_item_id", "user_id"]
            isOneToOne: false
            referencedRelation: "content_items"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "assets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_profiles: {
        Row: {
          created_at: string
          do_list: string[]
          dont_list: string[]
          id: string
          sample_text: string | null
          tone: string | null
          updated_at: string
          user_id: string
          voice_traits: string[]
        }
        Insert: {
          created_at?: string
          do_list?: string[]
          dont_list?: string[]
          id?: string
          sample_text?: string | null
          tone?: string | null
          updated_at?: string
          user_id: string
          voice_traits?: string[]
        }
        Update: {
          created_at?: string
          do_list?: string[]
          dont_list?: string[]
          id?: string
          sample_text?: string | null
          tone?: string | null
          updated_at?: string
          user_id?: string
          voice_traits?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "brand_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      competitors: {
        Row: {
          created_at: string
          handle: string | null
          id: string
          notes: string | null
          platform: string
          updated_at: string
          url: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          handle?: string | null
          id?: string
          notes?: string | null
          platform: string
          updated_at?: string
          url?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          handle?: string | null
          id?: string
          notes?: string | null
          platform?: string
          updated_at?: string
          url?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "competitors_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      content_ideas: {
        Row: {
          ai_generation_id: string | null
          angle: string | null
          audience_fit: string | null
          audience_need: string | null
          content_gap: string | null
          created_at: string
          cta: string | null
          difficulty: string | null
          evidence: Json
          evidence_strength: string | null
          format: string | null
          hook: string | null
          id: string
          pillar_id: string | null
          platform: string | null
          rationale: string | null
          source: string
          status: string
          topic: string
          trend_signal: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          ai_generation_id?: string | null
          angle?: string | null
          audience_fit?: string | null
          audience_need?: string | null
          content_gap?: string | null
          created_at?: string
          cta?: string | null
          difficulty?: string | null
          evidence?: Json
          evidence_strength?: string | null
          format?: string | null
          hook?: string | null
          id?: string
          pillar_id?: string | null
          platform?: string | null
          rationale?: string | null
          source?: string
          status?: string
          topic: string
          trend_signal?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          ai_generation_id?: string | null
          angle?: string | null
          audience_fit?: string | null
          audience_need?: string | null
          content_gap?: string | null
          created_at?: string
          cta?: string | null
          difficulty?: string | null
          evidence?: Json
          evidence_strength?: string | null
          format?: string | null
          hook?: string | null
          id?: string
          pillar_id?: string | null
          platform?: string | null
          rationale?: string | null
          source?: string
          status?: string
          topic?: string
          trend_signal?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_ideas_pillar_id_user_id_fkey"
            columns: ["pillar_id", "user_id"]
            isOneToOne: false
            referencedRelation: "content_pillars"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "content_ideas_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      content_items: {
        Row: {
          created_at: string
          format: string | null
          id: string
          idea_id: string | null
          pillar_id: string | null
          platform: string | null
          published_at: string | null
          published_url: string | null
          scheduled_for: string | null
          status: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          format?: string | null
          id?: string
          idea_id?: string | null
          pillar_id?: string | null
          platform?: string | null
          published_at?: string | null
          published_url?: string | null
          scheduled_for?: string | null
          status?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          format?: string | null
          id?: string
          idea_id?: string | null
          pillar_id?: string | null
          platform?: string | null
          published_at?: string | null
          published_url?: string | null
          scheduled_for?: string | null
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_items_idea_id_user_id_fkey"
            columns: ["idea_id", "user_id"]
            isOneToOne: false
            referencedRelation: "content_ideas"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "content_items_pillar_id_user_id_fkey"
            columns: ["pillar_id", "user_id"]
            isOneToOne: false
            referencedRelation: "content_pillars"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "content_items_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      content_pillars: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          position: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          position?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          position?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_pillars_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      content_versions: {
        Row: {
          ai_generation_id: string | null
          content: Json
          content_item_id: string
          created_at: string
          id: string
          note: string | null
          source: string
          user_id: string
          version_no: number
        }
        Insert: {
          ai_generation_id?: string | null
          content?: Json
          content_item_id: string
          created_at?: string
          id?: string
          note?: string | null
          source: string
          user_id: string
          version_no: number
        }
        Update: {
          ai_generation_id?: string | null
          content?: Json
          content_item_id?: string
          created_at?: string
          id?: string
          note?: string | null
          source?: string
          user_id?: string
          version_no?: number
        }
        Relationships: [
          {
            foreignKeyName: "content_versions_content_item_id_user_id_fkey"
            columns: ["content_item_id", "user_id"]
            isOneToOne: false
            referencedRelation: "content_items"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "content_versions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      creator_insights: {
        Row: {
          confidence: string | null
          created_at: string
          evidence: Json
          id: string
          insight_type: string
          sample_size: number | null
          status: string
          summary: string
          updated_at: string
          user_id: string
        }
        Insert: {
          confidence?: string | null
          created_at?: string
          evidence?: Json
          id?: string
          insight_type: string
          sample_size?: number | null
          status?: string
          summary: string
          updated_at?: string
          user_id: string
        }
        Update: {
          confidence?: string | null
          created_at?: string
          evidence?: Json
          id?: string
          insight_type?: string
          sample_size?: number | null
          status?: string
          summary?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "creator_insights_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      creator_strategies: {
        Row: {
          ai_generation_id: string | null
          audience_profile: Json
          created_at: string
          format_strategy: Json
          growth_objective: string
          id: string
          monetization_objective: string
          notes: string | null
          positioning: string
          prompt_version: string | null
          thirty_day_plan: Json
          updated_at: string
          user_id: string
          version: number
          voice_profile: Json
        }
        Insert: {
          ai_generation_id?: string | null
          audience_profile: Json
          created_at?: string
          format_strategy: Json
          growth_objective: string
          id?: string
          monetization_objective: string
          notes?: string | null
          positioning: string
          prompt_version?: string | null
          thirty_day_plan: Json
          updated_at?: string
          user_id: string
          version?: number
          voice_profile: Json
        }
        Update: {
          ai_generation_id?: string | null
          audience_profile?: Json
          created_at?: string
          format_strategy?: Json
          growth_objective?: string
          id?: string
          monetization_objective?: string
          notes?: string | null
          positioning?: string
          prompt_version?: string | null
          thirty_day_plan?: Json
          updated_at?: string
          user_id?: string
          version?: number
          voice_profile?: Json
        }
        Relationships: [
          {
            foreignKeyName: "creator_strategies_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      creator_profiles: {
        Row: {
          audience_description: string | null
          created_at: string
          experience_level: string | null
          goals: string[]
          id: string
          niche: string | null
          onboarding_status: string
          platforms: string[]
          posting_capacity_per_week: number | null
          timezone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          audience_description?: string | null
          created_at?: string
          experience_level?: string | null
          goals?: string[]
          id?: string
          niche?: string | null
          onboarding_status?: string
          platforms?: string[]
          posting_capacity_per_week?: number | null
          timezone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          audience_description?: string | null
          created_at?: string
          experience_level?: string | null
          goals?: string[]
          id?: string
          niche?: string | null
          onboarding_status?: string
          platforms?: string[]
          posting_capacity_per_week?: number | null
          timezone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "creator_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          link: string | null
          read_at: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          link?: string | null
          read_at?: string | null
          title: string
          type: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          link?: string | null
          read_at?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      research_signals: {
        Row: {
          created_at: string
          expires_at: string | null
          external_id: string | null
          fetched_at: string
          id: string
          payload: Json
          signal_type: string
          source: string
          source_url: string | null
          title: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          external_id?: string | null
          fetched_at?: string
          id?: string
          payload?: Json
          signal_type: string
          source: string
          source_url?: string | null
          title?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          external_id?: string | null
          fetched_at?: string
          id?: string
          payload?: Json
          signal_type?: string
          source?: string
          source_url?: string | null
          title?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "research_signals_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string | null
          id: string
          plan: string
          provider_customer_id: string | null
          provider_subscription_id: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          id?: string
          plan?: string
          provider_customer_id?: string | null
          provider_subscription_id?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          id?: string
          plan?: string
          provider_customer_id?: string | null
          provider_subscription_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_events: {
        Row: {
          ai_generation_id: string | null
          cost_micros: number | null
          created_at: string
          event_type: string
          id: string
          metadata: Json
          quantity: number
          user_id: string
        }
        Insert: {
          ai_generation_id?: string | null
          cost_micros?: number | null
          created_at?: string
          event_type: string
          id?: string
          metadata?: Json
          quantity?: number
          user_id: string
        }
        Update: {
          ai_generation_id?: string | null
          cost_micros?: number | null
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json
          quantity?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "usage_events_ai_generation_id_user_id_fkey"
            columns: ["ai_generation_id", "user_id"]
            isOneToOne: false
            referencedRelation: "ai_generations"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "usage_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      save_creator_strategy: {
        Args: { p_pillars: Json; p_strategy: Json }
        Returns: number
      }
      schedule_content_ideas: {
        Args: { p_slots: Json }
        Returns: number
      }
      schedule_content_item: {
        Args: { p_item_id: string; p_scheduled_for: string }
        Returns: undefined
      }
      start_studio_item: {
        Args: { p_idea_id: string }
        Returns: string
      }
      unschedule_content_item: {
        Args: { p_item_id: string }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
